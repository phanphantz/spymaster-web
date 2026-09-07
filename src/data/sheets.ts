/**
 * Tab names in the Game Data spreadsheet. They are the download key, the id of a table in
 * memory, and the JSON filename, so they must match the spreadsheet exactly.
 *
 * Mirrors `Assets/Scripts/Spymaster/Core/Data/GameDataSheets.cs`. The workbook's Map tab is
 * documentation and is deliberately absent.
 */
export const SHEETS = {
    // Character
    AgentData: 'AgentData',
    CharacterData: 'CharacterData',
    Habit: 'Habit',

    // Gameplay variables
    Skill: 'Skill',
    Item: 'Item',
    Stat: 'Stat',

    // Location
    Location: 'Location',
    Country: 'Country',
    State: 'State',

    // Mission
    Mission: 'Mission',
    Task: 'Task',

    // Mission building blocks
    Outcome: 'Outcome',
    Gate: 'Gate',
    Incident: 'Incident',
    Effect: 'Effect',
    SlotRequirement: 'SlotRequirement',

    // Event
    GlobalEvent: 'GlobalEvent',
    MissionEvent: 'MissionEvent',
    Conversation: 'Conversation',
    ConversationPool: 'ConversationPool',

    // Progression and reward
    AgentLevel: 'AgentLevel',
    PlayerLevel: 'PlayerLevel',
    Employment: 'Employment',
    AgentPool: 'AgentPool',
    RewardPool: 'RewardPool',

    // Progression and narrative
    MissionFeed: 'MissionFeed',
    MissionPool: 'MissionPool',
    GlobalEventFeed: 'GlobalEventFeed',
    GlobalEventPool: 'GlobalEventPool',
    MissionEventPool: 'MissionEventPool',

    // Progression and challenge
    MissionDifficulty: 'MissionDifficulty',
    MissionPenalty: 'MissionPenalty',
    PenaltyPool: 'PenaltyPool',
    Penalty: 'Penalty',

    // Vocabulary
    Tag: 'Tag',
    ItemType: 'ItemType',
    ItemSize: 'ItemSize',
    MissionType: 'MissionType',
    TaskType: 'TaskType',
    OutcomeType: 'OutcomeType',
    IncidentType: 'IncidentType',
    EffectType: 'EffectType',
    PenaltyType: 'PenaltyType',
    SkillType: 'SkillType',
    PriorityType: 'PriorityType',
    LocationType: 'LocationType',
    ConditionType: 'ConditionType',

    // Single instance
    GlobalConfig: 'GlobalConfig',
} as const;

export type SheetName = (typeof SHEETS)[keyof typeof SHEETS];

/** Every tab the loader reads, in workbook order. */
export const ALL_SHEETS: readonly SheetName[] = [
    SHEETS.AgentData, SHEETS.CharacterData, SHEETS.Habit,
    SHEETS.Skill, SHEETS.Item, SHEETS.Stat,
    SHEETS.Location, SHEETS.Country, SHEETS.State,
    SHEETS.Mission, SHEETS.Task,
    SHEETS.Outcome, SHEETS.Gate, SHEETS.Incident, SHEETS.Effect, SHEETS.SlotRequirement,
    SHEETS.GlobalEvent, SHEETS.MissionEvent, SHEETS.Conversation, SHEETS.ConversationPool,
    SHEETS.AgentLevel, SHEETS.PlayerLevel, SHEETS.Employment, SHEETS.AgentPool, SHEETS.RewardPool,
    SHEETS.MissionFeed, SHEETS.MissionPool, SHEETS.GlobalEventFeed, SHEETS.GlobalEventPool,
    SHEETS.MissionEventPool,
    SHEETS.MissionDifficulty, SHEETS.MissionPenalty, SHEETS.PenaltyPool, SHEETS.Penalty,
    SHEETS.Tag, SHEETS.ItemType, SHEETS.ItemSize, SHEETS.MissionType, SHEETS.TaskType,
    SHEETS.OutcomeType, SHEETS.IncidentType, SHEETS.EffectType, SHEETS.PenaltyType,
    SHEETS.SkillType, SHEETS.PriorityType, SHEETS.LocationType, SHEETS.ConditionType,
    SHEETS.GlobalConfig,
];

/**
 * Which column holds a tab's identity. Every table is indexed by this, and it is the key a
 * later data layer merges against.
 *
 * `AgentLevel` is keyed on two columns because a row is one character's curve at one level, and
 * `Task` predates its own id in some data, so both get a composite spelled out in `load.ts`.
 */
export const ID_FIELD: Record<SheetName, string> = {
    AgentData: 'characterId',
    CharacterData: 'id',
    Habit: 'habitId',
    Skill: 'skillId',
    Item: 'itemId',
    Stat: 'statId',
    Location: 'locationId',
    Country: 'country',
    State: 'state',
    Mission: 'missionId',
    Task: 'taskId',
    Outcome: 'outcomeId',
    Gate: 'gateId',
    Incident: 'incidentId',
    Effect: 'effectId',
    SlotRequirement: 'slotId',
    GlobalEvent: 'eventId',
    MissionEvent: 'eventId',
    Conversation: 'conversationId',
    ConversationPool: 'poolId',
    AgentLevel: 'level',
    PlayerLevel: 'level',
    Employment: 'feedId',
    AgentPool: 'poolId',
    RewardPool: 'poolId',
    MissionFeed: 'feedId',
    MissionPool: 'poolId',
    GlobalEventFeed: 'feedId',
    GlobalEventPool: 'poolId',
    MissionEventPool: 'poolId',
    MissionDifficulty: 'difficultyLevel',
    MissionPenalty: 'penaltyLevel',
    PenaltyPool: 'poolId',
    Penalty: 'penaltyId',
    Tag: 'tagId',
    ItemType: 'itemTypeId',
    ItemSize: 'itemSizeId',
    MissionType: 'missionTypeId',
    TaskType: 'taskTypeId',
    OutcomeType: 'outcomeTypeId',
    IncidentType: 'incidentTypeId',
    EffectType: 'effectTypeId',
    PenaltyType: 'penaltyTypeId',
    SkillType: 'skillTypeId',
    PriorityType: 'priorityTypeId',
    LocationType: 'locationTypeId',
    ConditionType: 'conditionId',
    GlobalConfig: 'configKey',
};

/**
 * Tabs whose identity needs more than one column. `AgentLevel` is `(characterId, level)` — a row
 * is one character's curve at one level, not a curve shared across every agent.
 */
export const COMPOSITE_ID: Partial<Record<SheetName, readonly string[]>> = {
    AgentLevel: ['characterId', 'level'],
};
