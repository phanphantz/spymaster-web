import type { SheetName } from './sheets';

/**
 * Turns the sheet's all-string cells into the numbers, booleans and arrays the row types declare.
 *
 * Unity gets this for free: Newtonsoft deserializes straight into the typed `Setting` subclass, and
 * `StringToCollectionConverter` splits a comma-separated cell into a list. There is no such target
 * type at runtime here, so the same knowledge is written out below.
 *
 * Field names are consistent across the workbook, so one global table covers almost everything;
 * only genuinely ambiguous names need a per-tab override.
 */

const NUMBER_FIELDS = new Set([
    // shared value types
    'qty', 'weight',
    // agent and character
    'baseHealth', 'baseInventorySize', 'age',
    'ast', 'end', 'sth', 'pre', 'int', 'cha',
    'minAgentLevel', 'minMissionAssigned',
    // items
    'usageCount', 'consumeItemQty',
    'astEffect', 'endEffect', 'sthEffect', 'preEffect', 'intEffect', 'chaEffect',
    'priceItemQty', 'minPlayerLevel', 'maxOwnedCount',
    // stats and locations
    'minValue', 'maxValue', 'latitude', 'longitude', 'floorCount',
    // missions
    'difficultyLevel', 'penaltyLevel', 'restTimeInHour', 'minDurationInHours',
    // slots
    'minLevel',
    // incidents and progression
    'rewardExp', 'rewardUpgradePoint', 'level', 'accumulativeExp', 'rewardStatPoint',
    'pickQty', 'reqPlayerLevel',
    // feeds
    'maxActiveCount', 'minFeedIntervalMinute', 'maxFeedIntervalMinute',
    'minCount', 'maxCount', 'minIntervalHour', 'maxIntervalHour',
    'minPenalty', 'maxPenalty',
]);

const BOOLEAN_FIELDS = new Set([
    'isMandatory', 'isInShop', 'isDeclinable', 'isCanon', 'isHidden', 'isSilent',
    'isGoneAfterUse', 'isDetectedByScanner', 'isWaterproof',
]);

/** Fields that are always a list, whatever the header row happened to look like. */
const ARRAY_FIELDS = new Set([
    'baseSkillIds', 'habits', 'tags', 'excludedTags', 'codeNames', 'nationalities',
    'subAreaIds', 'incidents', 'outcomes', 'starterTasks', 'nextTasks',
    'slotReqIds', 'reqSkillIds', 'unlockedSkillIds',
]);

/**
 * Names that mean different things on different tabs.
 *
 * `type` is a list on Item — an Item may read as several types at once — and a single value
 * everywhere else. `isConcealed` looks boolean but holds a vocabulary value
 * (`concealed` / `canHide` / `visible`).
 */
const PER_SHEET: Partial<Record<SheetName, { array?: string[]; string?: string[] }>> = {
    Item: { array: ['type'], string: ['isConcealed'] },
};

/** Multi-value cells are comma-separated, matching StringToCollectionConverter. */
const LIST_SEPARATOR = ',';

function toNumber(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    // Authors type "1,200" in a currency column often enough to be worth tolerating.
    const parsed = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
}

function toBoolean(value: string): boolean | undefined {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === 'yes' || trimmed === '1') return true;
    if (trimmed === 'false' || trimmed === 'no' || trimmed === '0') return false;
    return undefined;
}

function splitList(value: string): string[] {
    return value
        .split(LIST_SEPARATOR)
        .map((part) => part.trim())
        .filter(Boolean);
}

function coerceScalar(field: string, value: unknown): unknown {
    if (typeof value !== 'string') return value;

    if (NUMBER_FIELDS.has(field)) return toNumber(value);
    if (BOOLEAN_FIELDS.has(field)) return toBoolean(value);
    return value;
}

/**
 * Coerces one row in place of its string form. Already-typed values pass straight through, so this
 * is safe to run over hand-authored seed JSON as well as over freshly parsed sheet cells.
 */
export function coerceRow<T extends object>(sheet: SheetName, row: Record<string, unknown>): T {
    const overrides = PER_SHEET[sheet];
    const arrayFields = overrides?.array;
    const stringFields = overrides?.string;

    const result: Record<string, unknown> = {};

    for (const [field, value] of Object.entries(row)) {
        if (value === undefined || value === null || value === '') continue;

        const isArrayField = ARRAY_FIELDS.has(field) || arrayFields?.includes(field) === true;
        const isStringField = stringFields?.includes(field) === true;

        if (isArrayField) {
            const list = Array.isArray(value)
                ? value.flatMap((entry) => (typeof entry === 'string' ? splitList(entry) : [entry]))
                : typeof value === 'string'
                  ? splitList(value)
                  : [value];
            if (list.length) result[field] = list;
            continue;
        }

        if (Array.isArray(value)) {
            // An array of group entries: coerce each entry's own fields by the same rules.
            const entries = value
                .map((entry) =>
                    entry && typeof entry === 'object'
                        ? coerceRow(sheet, entry as Record<string, unknown>)
                        : entry,
                )
                .filter((entry) => entry !== undefined && Object.keys(entry as object).length > 0);
            if (entries.length) result[field] = entries;
            continue;
        }

        const coerced = isStringField ? value : coerceScalar(field, value);
        if (coerced !== undefined) result[field] = coerced;
    }

    return result as T;
}

export function coerceRows<T extends object>(
    sheet: SheetName,
    rows: readonly Record<string, unknown>[],
): T[] {
    return rows.map((row) => coerceRow<T>(sheet, row));
}
