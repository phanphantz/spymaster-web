import { SHEETS, ID_FIELD, type SheetName } from './sheets';
import type { MergedRows } from './merge';

/**
 * Reports references that point at nothing.
 *
 * Mocks and seed rows are written by hand, and a mistyped id is otherwise invisible: a Mission whose
 * `gateId` names a Gate that does not exist just quietly opens with no slots, and an Outcome whose
 * Incident is missing simply pays nothing. This turns that into a readable line.
 *
 * Vocabulary references are warnings rather than errors, because most vocabulary tabs are still
 * unauthored in the live sheet and a missing `MissionType` row breaks nothing.
 */

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
    severity: Severity;
    sheet: SheetName;
    /** Row identity, as far as it could be worked out. */
    rowId: string;
    /** Where in the row the bad reference sits, e.g. `reqItems[].itemId`. */
    path: string;
    /** The id that resolved to nothing. */
    value: string;
    target: SheetName;
    message: string;
}

interface Reference {
    from: SheetName;
    /** Dotted path with `[]` marking a list, e.g. `pools[].poolId`. */
    path: string;
    to: SheetName;
    severity?: Severity;
}

const VOCAB: Severity = 'warning';

const REFERENCES: readonly Reference[] = [
    // Character
    { from: SHEETS.AgentData, path: 'baseSkillIds[]', to: SHEETS.Skill },
    { from: SHEETS.AgentData, path: 'habits[]', to: SHEETS.Habit },
    { from: SHEETS.AgentData, path: 'tags[]', to: SHEETS.Tag, severity: VOCAB },
    { from: SHEETS.AgentLevel, path: 'characterId', to: SHEETS.AgentData },
    { from: SHEETS.AgentLevel, path: 'unlockedSkillIds[]', to: SHEETS.Skill },
    { from: SHEETS.AgentLevel, path: 'rewardItems[].itemId', to: SHEETS.Item },
    { from: SHEETS.AgentLevel, path: 'greetingPoolId', to: SHEETS.ConversationPool },
    { from: SHEETS.PlayerLevel, path: 'rewardItems[].itemId', to: SHEETS.Item },
    { from: SHEETS.Habit, path: 'tags[]', to: SHEETS.Tag, severity: VOCAB },

    // Gameplay variables
    { from: SHEETS.Skill, path: 'type', to: SHEETS.SkillType, severity: VOCAB },
    { from: SHEETS.Item, path: 'type[]', to: SHEETS.ItemType, severity: VOCAB },
    { from: SHEETS.Item, path: 'size', to: SHEETS.ItemSize, severity: VOCAB },
    { from: SHEETS.Item, path: 'priceItemId', to: SHEETS.Item },
    { from: SHEETS.Item, path: 'consumeItemId', to: SHEETS.Item },

    // Location
    { from: SHEETS.Location, path: 'country', to: SHEETS.Country, severity: VOCAB },
    { from: SHEETS.Location, path: 'state', to: SHEETS.State, severity: VOCAB },
    { from: SHEETS.Location, path: 'type', to: SHEETS.LocationType, severity: VOCAB },
    { from: SHEETS.State, path: 'country', to: SHEETS.Country, severity: VOCAB },

    // Mission
    { from: SHEETS.Mission, path: 'gateId', to: SHEETS.Gate },
    { from: SHEETS.Mission, path: 'outcomes[]', to: SHEETS.Outcome },
    { from: SHEETS.Mission, path: 'incidents[]', to: SHEETS.Incident },
    { from: SHEETS.Mission, path: 'restIncidentId', to: SHEETS.Incident },
    { from: SHEETS.Mission, path: 'starterTasks[]', to: SHEETS.Task },
    { from: SHEETS.Mission, path: 'locationId', to: SHEETS.Location },
    { from: SHEETS.Mission, path: 'type', to: SHEETS.MissionType, severity: VOCAB },
    { from: SHEETS.Mission, path: 'priorityType', to: SHEETS.PriorityType, severity: VOCAB },
    { from: SHEETS.Task, path: 'outcomes[]', to: SHEETS.Outcome },
    { from: SHEETS.Task, path: 'incidents[]', to: SHEETS.Incident },
    { from: SHEETS.Task, path: 'slotReqIds[]', to: SHEETS.SlotRequirement },
    { from: SHEETS.Task, path: 'locationId', to: SHEETS.Location },

    // Mission building blocks
    { from: SHEETS.Gate, path: 'slotReqIds[]', to: SHEETS.SlotRequirement },
    { from: SHEETS.Gate, path: 'reqItems[].itemId', to: SHEETS.Item },
    { from: SHEETS.Gate, path: 'reqSkillIds[]', to: SHEETS.Skill },
    { from: SHEETS.Gate, path: 'conditions[].conditionId', to: SHEETS.ConditionType },
    { from: SHEETS.Outcome, path: 'gateId', to: SHEETS.Gate },
    { from: SHEETS.Outcome, path: 'incidents[]', to: SHEETS.Incident },
    { from: SHEETS.Outcome, path: 'nextTasks[]', to: SHEETS.Task },
    { from: SHEETS.Outcome, path: 'type', to: SHEETS.OutcomeType, severity: VOCAB },
    { from: SHEETS.Incident, path: 'effects[].effectId', to: SHEETS.Effect },
    { from: SHEETS.Incident, path: 'costItems[].itemId', to: SHEETS.Item },
    { from: SHEETS.Incident, path: 'rewardItems[].itemId', to: SHEETS.Item },
    { from: SHEETS.Incident, path: 'type', to: SHEETS.IncidentType, severity: VOCAB },
    { from: SHEETS.Effect, path: 'type', to: SHEETS.EffectType, severity: VOCAB },
    { from: SHEETS.SlotRequirement, path: 'tags[]', to: SHEETS.Tag, severity: VOCAB },
    { from: SHEETS.SlotRequirement, path: 'excludedTags[]', to: SHEETS.Tag, severity: VOCAB },

    // Events
    { from: SHEETS.MissionEvent, path: 'choices[].incidentId', to: SHEETS.Incident },
    { from: SHEETS.GlobalEvent, path: 'choices[].incidentId', to: SHEETS.Incident },
    { from: SHEETS.Conversation, path: 'characterId', to: SHEETS.AgentData },
    { from: SHEETS.Conversation, path: 'incidentId', to: SHEETS.Incident },

    // Feeds and pools
    { from: SHEETS.Employment, path: 'pools[].poolId', to: SHEETS.AgentPool },
    { from: SHEETS.MissionFeed, path: 'pools[].poolId', to: SHEETS.MissionPool },
    { from: SHEETS.GlobalEventFeed, path: 'pools[].poolId', to: SHEETS.GlobalEventPool },
    { from: SHEETS.MissionPenalty, path: 'pools[].poolId', to: SHEETS.PenaltyPool },
    { from: SHEETS.MissionDifficulty, path: 'randomEventPools[].poolId', to: SHEETS.MissionEventPool },
    { from: SHEETS.AgentPool, path: 'entries[].entryId', to: SHEETS.AgentData },
    { from: SHEETS.MissionPool, path: 'entries[].entryId', to: SHEETS.Mission },
    { from: SHEETS.RewardPool, path: 'entries[].entryId', to: SHEETS.Item },
    { from: SHEETS.PenaltyPool, path: 'entries[].entryId', to: SHEETS.Penalty },
    { from: SHEETS.MissionEventPool, path: 'entries[].entryId', to: SHEETS.MissionEvent },
    { from: SHEETS.GlobalEventPool, path: 'entries[].entryId', to: SHEETS.GlobalEvent },
    { from: SHEETS.ConversationPool, path: 'entries[].entryId', to: SHEETS.Conversation },
    { from: SHEETS.Penalty, path: 'type', to: SHEETS.PenaltyType, severity: VOCAB },
];

/** Walks a `foo[].bar` path and yields every string it lands on. */
function resolvePath(row: unknown, segments: readonly string[]): string[] {
    if (row === undefined || row === null) return [];

    if (!segments.length) {
        if (typeof row === 'string') return row ? [row] : [];
        if (typeof row === 'number') return [String(row)];
        return [];
    }

    const [head, ...rest] = segments;

    if (head === '[]') {
        return Array.isArray(row) ? row.flatMap((entry) => resolvePath(entry, rest)) : [];
    }

    if (typeof row !== 'object') return [];
    return resolvePath((row as Record<string, unknown>)[head], rest);
}

function parsePath(path: string): string[] {
    return path
        .replace(/\[\]/g, '.[].')
        .split('.')
        .filter(Boolean);
}

/**
 * A Gate naming the same slot twice.
 *
 * Assignments are keyed by `slotId`, so two slots sharing an id collapse onto one agent: the
 * Loadout shows two openings, one of them silently overwrites the other, and that single agent then
 * absorbs the Mission's effects once per slot. Nothing about it looks wrong on screen, which is
 * exactly why it needs catching here.
 */
function checkDuplicateSlots(rows: MergedRows): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const gate of rows[SHEETS.Gate]) {
        const slotIds = gate.slotReqIds;
        if (!Array.isArray(slotIds)) continue;

        const seen = new Set<string>();
        for (const slotId of slotIds) {
            const id = String(slotId);
            if (seen.has(id)) {
                issues.push({
                    severity: 'error',
                    sheet: SHEETS.Gate,
                    rowId: String(gate.gateId ?? '(no id)'),
                    path: 'slotReqIds[]',
                    value: id,
                    target: SHEETS.SlotRequirement,
                    message:
                        `Gate.${String(gate.gateId)} names slot "${id}" more than once. ` +
                        'Assignments are keyed by slotId, so the duplicate collapses onto one agent.',
                });
            }
            seen.add(id);
        }
    }

    return issues;
}

/**
 * Checks every declared reference against the merged tables.
 *
 * A tab with no rows at all is skipped rather than reported: an empty `Habit` tab means habits are
 * not authored yet, not that every `habits` entry is broken.
 */
export function validate(rows: MergedRows): ValidationIssue[] {
    const issues: ValidationIssue[] = checkDuplicateSlots(rows);

    const idsOf = new Map<SheetName, Set<string>>();
    const idsFor = (sheet: SheetName): Set<string> => {
        let ids = idsOf.get(sheet);
        if (!ids) {
            ids = new Set(
                rows[sheet]
                    .map((row) => row[ID_FIELD[sheet]])
                    .filter((id) => id !== undefined && id !== null && id !== '')
                    .map(String),
            );
            idsOf.set(sheet, ids);
        }
        return ids;
    };

    for (const reference of REFERENCES) {
        const targetIds = idsFor(reference.to);
        if (!targetIds.size) continue;

        const segments = parsePath(reference.path);

        for (const row of rows[reference.from]) {
            for (const value of resolvePath(row, segments)) {
                if (targetIds.has(value)) continue;

                issues.push({
                    severity: reference.severity ?? 'error',
                    sheet: reference.from,
                    rowId: String(row[ID_FIELD[reference.from]] ?? '(no id)'),
                    path: reference.path,
                    value,
                    target: reference.to,
                    message:
                        `${reference.from}.${String(row[ID_FIELD[reference.from]] ?? '?')}` +
                        ` → ${reference.path} = "${value}" is not in ${reference.to}`,
                });
            }
        }
    }

    return issues;
}

/** Groups issues for a one-line summary. */
export function summarise(issues: readonly ValidationIssue[]): {
    errors: number;
    warnings: number;
} {
    return {
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
    };
}
