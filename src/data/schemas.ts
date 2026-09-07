import { SHEETS, type SheetName } from './sheets';

/**
 * Which columns of each tab repeat as a unit, so import can fold them into JSON arrays.
 *
 * Port of `Assets/Scripts/Spymaster/Core/Data/GameDataSheetSchemas.cs`. This is the only place the
 * sheet's column layout is described, and it is what keeps the row types free of parallel columns.
 *
 * A single column that simply repeats — `tags | tags | tags` — needs no entry here; the layout
 * spots those on its own. Only a group spanning more than one column has to be declared, because
 * nothing in the header row says which columns belong together.
 */

/** One repeating unit: the columns it spans, and the JSON key each becomes inside an entry. */
export interface SheetColumnGroup {
    /** The array member this group builds on the row. */
    memberName: string;
    /** Header names, in order, that make up one entry. */
    columns: readonly string[];
    /** JSON keys, positionally matching `columns`. */
    keys: readonly string[];
}

export interface SheetSchema {
    sheetName: SheetName;
    /** Field names run down column A and each record is a column. True for every pool tab. */
    isTransposed: boolean;
    groups: readonly SheetColumnGroup[];
}

function group(
    memberName: string,
    ...pairs: readonly (readonly [column: string, key: string])[]
): SheetColumnGroup {
    return {
        memberName,
        columns: pairs.map(([column]) => column),
        keys: pairs.map(([, key]) => key),
    };
}

/** Every ...ItemId / ...ItemQty pair in the workbook lands on ItemAmount, whatever the tab calls it. */
function itemAmounts(memberName: string, idColumn: string, qtyColumn: string): SheetColumnGroup {
    return group(memberName, [idColumn, 'itemId'], [qtyColumn, 'qty']);
}

/** Feeds, Employment and MissionDifficulty all draw from pools; only the quantity column differs. */
function poolDraws(memberName: string, poolColumn: string, qtyColumn: string): SheetColumnGroup {
    return group(memberName, [poolColumn, 'poolId'], [qtyColumn, 'qty']);
}

function properties(): SheetColumnGroup {
    return group('properties', ['propName', 'propName'], ['propValue', 'propValue']);
}

function eventChoices(): SheetColumnGroup {
    return group(
        'choices',
        ['choiceId', 'choiceId'],
        ['choiceDisplayName', 'choiceDisplayName'],
        ['incidentId', 'incidentId'],
    );
}

/**
 * The pool tabs are the sideways ones: field names run down column A and each pool is a column,
 * with its entries repeating down it.
 *
 * Two pieces of tolerance are deliberate here, because the live workbook does not match the Unity
 * schema today:
 *
 * - The entry column is declared `entryId` in Unity but still spelled per-tab in the sheet
 *   (`missionId`, `agentId`, ...), so every alias is accepted.
 * - `characterId` is optional. Unity declares a three-column group and the sheet authors only two,
 *   which is why that group currently never matches there. Wider variants are listed first so a
 *   pool that *does* carry `characterId` still folds correctly.
 */
function transposedPool(sheetName: SheetName, ...entryAliases: readonly string[]): SheetSchema {
    const entryColumns = ['entryId', ...entryAliases];

    return {
        sheetName,
        isTransposed: true,
        groups: [
            ...entryColumns.map((entryColumn) =>
                group(
                    'entries',
                    [entryColumn, 'entryId'],
                    ['weight', 'weight'],
                    ['characterId', 'characterId'],
                ),
            ),
            ...entryColumns.map((entryColumn) =>
                group('entries', [entryColumn, 'entryId'], ['weight', 'weight']),
            ),
        ],
    };
}

function schema(sheetName: SheetName, ...groups: readonly SheetColumnGroup[]): SheetSchema {
    return { sheetName, isTransposed: false, groups };
}

const ALL: readonly SheetSchema[] = [
    schema(SHEETS.Skill, properties()),
    schema(SHEETS.Item, properties()),
    schema(SHEETS.Location, properties()),
    schema(SHEETS.Country, properties()),
    schema(SHEETS.State, properties()),

    schema(
        SHEETS.Gate,
        group('conditions', ['conditionId', 'conditionId'], ['conditionValue', 'conditionValue']),
        itemAmounts('reqItems', 'reqItemId', 'reqItemQty'),
    ),

    schema(
        SHEETS.Incident,
        group('effects', ['effectId', 'effectId'], ['effectValue', 'effectValue']),
        itemAmounts('costItems', 'costItemId', 'costItemQty'),
        itemAmounts('rewardItems', 'rewardItemId', 'rewardItemQty'),
    ),

    schema(SHEETS.GlobalEvent, eventChoices()),
    schema(SHEETS.MissionEvent, eventChoices()),

    schema(SHEETS.AgentLevel, itemAmounts('rewardItems', 'rewardItemId', 'rewardItemQty')),
    schema(SHEETS.PlayerLevel, itemAmounts('rewardItems', 'rewardItemId', 'rewardItemQty')),

    schema(SHEETS.Employment, poolDraws('pools', 'poolId', 'choiceQty')),
    schema(SHEETS.MissionFeed, poolDraws('pools', 'poolId', 'missionQty')),
    schema(SHEETS.GlobalEventFeed, poolDraws('pools', 'poolId', 'choiceQty')),
    schema(SHEETS.MissionPenalty, poolDraws('pools', 'poolId', 'choiceQty')),
    schema(
        SHEETS.MissionDifficulty,
        poolDraws('randomEventPools', 'randomEventPoolId', 'randomEventQty'),
    ),

    transposedPool(SHEETS.AgentPool, 'agentId', 'characterId'),
    transposedPool(SHEETS.MissionPool, 'missionId'),
    transposedPool(SHEETS.PenaltyPool, 'penaltyId'),
    transposedPool(SHEETS.RewardPool, 'itemId'),
    transposedPool(SHEETS.ConversationPool, 'conversationId'),
    transposedPool(SHEETS.GlobalEventPool, 'eventId'),
    transposedPool(SHEETS.MissionEventPool, 'eventId'),
];

const BY_SHEET = new Map<string, SheetSchema>(ALL.map((entry) => [entry.sheetName, entry]));

/** The schema for a tab, or undefined when its columns need no grouping. */
export function schemaFor(sheetName: string): SheetSchema | undefined {
    return BY_SHEET.get(sheetName);
}
