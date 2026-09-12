/**
 * Row shapes for every Game Data tab.
 *
 * These mirror the `Setting` subclasses in the Unity project field for field, because the field
 * name *is* the sheet column name and the JSON key. Keep them in step: renaming a field here
 * means renaming a column in the spreadsheet.
 *
 * Everything is optional. The importer omits blank cells entirely, so a row carries only what was
 * actually authored — which is what lets a partial row from a later data layer act as a patch.
 */

// ---------------------------------------------------------------------------
// Shared value types (Core/Data/DataPrimitives.cs)
// ---------------------------------------------------------------------------

export interface Property {
    propName?: string;
    propValue?: string;
}

/** Any ...ItemId / ...ItemQty column pair in the workbook folds into this. */
export interface ItemAmount {
    itemId?: string;
    qty?: number;
}

export interface AppliedEffect {
    effectId?: string;
    effectValue?: string;
}

export interface GateCondition {
    conditionId?: string;
    conditionValue?: string;
}

export interface EventChoice {
    choiceId?: string;
    choiceDisplayName?: string;
    incidentId?: string;
}

/** A Feed or Employment drawing from a pool. The quantity column differs per tab. */
export interface PoolDraw {
    poolId?: string;
    qty?: number;
}

export interface WeightedPoolEntry {
    entryId?: string;
    weight?: number;
    /** Optional: makes the draw chance differ when the pool is drawn for this character. */
    characterId?: string;
}

/** The six Stats as columns. C# spells the third-from-last @int; the JSON key is plain int. */
export interface StatColumns {
    ast?: number;
    end?: number;
    sth?: number;
    pre?: number;
    int?: number;
    cha?: number;
}

export const STAT_IDS = ['ast', 'end', 'sth', 'pre', 'int', 'cha'] as const;
export type StatId = (typeof STAT_IDS)[number];

/** Health is capped like a Stat but is not one of the six and is not on the hexagon. */
export const HEALTH_ID = 'health';

export const OUTCOME_TYPES = ['best', 'acceptable', 'bad', 'criticalFailure'] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

export const EFFECT_TYPES = [
    'injury', 'sickness', 'debuff', 'death', 'healthChange', 'statModifier',
    'itemGain', 'itemLoss', 'recovery', 'triggerEvent', 'triggerConversation',
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

export const CONDITION_LUCK_ROLL = 'luckRoll';

/** Money is an Item. There is no separate economy system. */
export const DOLLAR = 'dollar';

export const PLACEHOLDER_LOCATION = '{location}';
export const PLACEHOLDER_RANDOM_EVENT = '{randomEvent}';

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

export interface AgentData extends StatColumns {
    characterId?: string;
    rarity?: string;
    /** Fixed per-agent base. Never grows on level-up, only via a purchased Agent Upgrade. */
    baseHealth?: number;
    /** Fixed per-agent base, same rule as baseHealth. */
    baseInventorySize?: number;
    baseSkillIds?: string[];
    habits?: string[];
    tags?: string[];
}

export interface CharacterData {
    id?: string;
    firstName?: string;
    lastName?: string;
    middleName?: string;
    codeNames?: string[];
    description?: string;
    gender?: string;
    nationalities?: string[];
    age?: number;
    birthDate?: string;
}

export interface HabitData {
    habitId?: string;
    icon?: string;
    displayName?: string;
    description?: string;
    minAgentLevel?: number;
    minMissionAssigned?: number;
    tags?: string[];
}

// ---------------------------------------------------------------------------
// Gameplay variables
// ---------------------------------------------------------------------------

export interface SkillData {
    skillId?: string;
    type?: string;
    icon?: string;
    displayName?: string;
    description?: string;
    properties?: Property[];
    tags?: string[];
}

export interface ItemData {
    itemId?: string;
    /** An Item may read as several types at once. */
    type?: string[];
    subType?: string;
    icon?: string;
    displayName?: string;
    description?: string;
    weight?: number;
    size?: string;

    /** Consumption. usageCount of 0 or -1 means unlimited. */
    usageCount?: number;
    isGoneAfterUse?: boolean;
    consumeItemId?: string;
    consumeItemQty?: number;

    /** How many of this item a single inventory slot can hold. Unset (or 1) means it doesn't stack. */
    maxStackCount?: number;

    /** Situational flags a Gate or an authored condition can read. */
    isConcealed?: string;
    isDetectedByScanner?: boolean;
    isWaterproof?: boolean;

    astEffect?: number;
    endEffect?: number;
    sthEffect?: number;
    preEffect?: number;
    intEffect?: number;
    chaEffect?: number;

    /** A price is itself an Item and a quantity. In practice it is always dollar. */
    priceItemId?: string;
    priceItemQty?: number;
    minPlayerLevel?: number;
    /** -1 is unlimited. An unauthored 0 reads as unlimited too, matching ShopModel. */
    maxOwnedCount?: number;
    isInShop?: boolean;

    properties?: Property[];
    tags?: string[];
}

export interface StatDefinition {
    statId?: string;
    displayName?: string;
    icon?: string;
    minValue?: number;
    maxValue?: number;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export interface LocationData {
    locationId?: string;
    latitude?: number;
    longitude?: number;
    country?: string;
    state?: string;
    address?: string;
    type?: string;
    displayName?: string;
    description?: string;
    locationSize?: string;
    floorCount?: number;
    subAreaIds?: string[];
    properties?: Property[];
    tags?: string[];
}

export interface CountryData {
    country?: string;
    latitude?: number;
    longitude?: number;
    properties?: Property[];
    tags?: string[];
}

export interface StateData {
    state?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    properties?: Property[];
    tags?: string[];
}

// ---------------------------------------------------------------------------
// Mission
// ---------------------------------------------------------------------------

/** Shared by Mission and Task: the two things that carry Incidents and Outcomes. */
export interface StoryPointData {
    type?: string;
    priorityType?: string;
    displayName?: string;
    description?: string;
    locationId?: string;
    incidents?: string[];
    /** Ordered tiers, best first. Evaluation stops at the first Gate that matches. */
    outcomes?: string[];
}

export interface MissionData extends StoryPointData {
    missionId?: string;
    hint?: string;
    /** Selects a random Event pool. No bearing on the result — see Mission Result Determination. */
    difficultyLevel?: number;
    penaltyLevel?: number;
    startTime?: string;
    endTime?: string;
    restTimeInHour?: number;
    restIncidentId?: string;
    /** Checked once before the Mission may start, and it is what enumerates the Loadout slots. */
    gateId?: string;
    starterTasks?: string[];
    isDeclinable?: boolean;
}

export interface TaskData extends StoryPointData {
    taskId?: string;
    isCanon?: boolean;
    isHidden?: boolean;
    minDurationInHours?: number;
    slotReqIds?: string[];
}

// ---------------------------------------------------------------------------
// Mission building blocks
// ---------------------------------------------------------------------------

export interface OutcomeData {
    outcomeId?: string;
    type?: string;
    gateId?: string;
    incidents?: string[];
    nextTasks?: string[];
}

/** Hard requirements, combined with AND. An empty Gate always matches. */
export interface GateData extends StatColumns {
    gateId?: string;
    slotReqIds?: string[];
    conditions?: GateCondition[];
    reqItems?: ItemAmount[];
    reqSkillIds?: string[];
}

export interface IncidentData {
    incidentId?: string;
    type?: string;
    isSilent?: boolean;
    displayName?: string;
    description?: string;
    rewardExp?: number;
    rewardUpgradePoint?: number;
    effects?: AppliedEffect[];
    costItems?: ItemAmount[];
    rewardItems?: ItemAmount[];
}

export interface EffectData {
    effectId?: string;
    type?: string;
    displayName?: string;
    description?: string;
}

/** What a Mission slot demands of the agent placed in it. Min stats here are per-agent. */
export interface SlotRequirementData extends StatColumns {
    slotId?: string;
    isMandatory?: boolean;
    minLevel?: number;
    tags?: string[];
    /** Rejects an agent outright by trait — the prohibited-agent case. */
    excludedTags?: string[];
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export interface EventData {
    eventId?: string;
    displayName?: string;
    description?: string;
    choices?: EventChoice[];
}

export interface ConversationData {
    conversationId?: string;
    characterId?: string;
    /** One cell, split on commas. */
    messages?: string;
    choiceId?: string;
    incidentId?: string;
}

export interface GlobalEventFeedData {
    feedId?: string;
    reqPlayerLevel?: number;
    minCount?: number;
    maxCount?: number;
    /** Hours here, unlike MissionFeed's minutes. */
    minIntervalHour?: number;
    maxIntervalHour?: number;
    pools?: PoolDraw[];
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

export interface AgentLevelData {
    characterId?: string;
    level?: number;
    /** Total EXP to reach this level, not the step from the previous one. */
    accumulativeExp?: number;
    rewardStatPoint?: number;
    unlockedSkillIds?: string[];
    rewardItems?: ItemAmount[];
    greetingPoolId?: string;
}

export interface PlayerLevelData {
    level?: number;
    accumulativeExp?: number;
    rewardUpgradePoint?: number;
    rewardItems?: ItemAmount[];
}

export interface EmploymentData {
    feedId?: string;
    reqPlayerLevel?: number;
    /** How many the player keeps out of the offered candidates. */
    pickQty?: number;
    /** Summed qty across pools is the offer size. */
    pools?: PoolDraw[];
}

export interface MissionFeedData {
    feedId?: string;
    reqPlayerLevel?: number;
    /** How many Missions may sit unanswered at once. 0 means no cap. */
    maxActiveCount?: number;
    minFeedIntervalMinute?: number;
    maxFeedIntervalMinute?: number;
    /** A pool's qty is its quota for this Feed. qty of 0 or less is unlimited. */
    pools?: PoolDraw[];
}

export interface MissionDifficultyData {
    difficultyLevel?: number;
    randomEventPools?: PoolDraw[];
}

export interface MissionPenaltyData {
    penaltyLevel?: number;
    minPenalty?: number;
    maxPenalty?: number;
    pools?: PoolDraw[];
}

export interface PenaltyData {
    penaltyId?: string;
    type?: string;
    displayName?: string;
    description?: string;
}

export interface WeightedPoolData {
    poolId?: string;
    entries?: WeightedPoolEntry[];
}

// ---------------------------------------------------------------------------
// Vocabulary and config
// ---------------------------------------------------------------------------

/** Every vocabulary tab names its id column after itself, so the JSON key is exact. */
export interface VocabularyEntry {
    displayName?: string;
    description?: string;
    [idColumn: string]: string | undefined;
}

export interface TagEntry extends VocabularyEntry {
    tagId?: string;
    /** Names the structure an entry belongs to. */
    scope?: string;
}

export interface GlobalConfigData {
    configKey?: string;
    value?: string;
    description?: string;
}

// ---------------------------------------------------------------------------
// The loaded workbook
// ---------------------------------------------------------------------------

/** One tab, indexed by its id column and keeping authored order. */
export interface Table<T> {
    readonly byId: ReadonlyMap<string, T>;
    /** Authored order. Load-bearing: Outcomes are tiers and Incidents run in sequence. */
    readonly rows: readonly T[];
    get(id: string | undefined): T | undefined;
    /** Resolves ids in order, skipping any that are missing. */
    getMany(ids: readonly string[] | undefined): T[];
}

export interface GameTables {
    AgentData: Table<AgentData>;
    CharacterData: Table<CharacterData>;
    Habit: Table<HabitData>;
    Skill: Table<SkillData>;
    Item: Table<ItemData>;
    Stat: Table<StatDefinition>;
    Location: Table<LocationData>;
    Country: Table<CountryData>;
    State: Table<StateData>;
    Mission: Table<MissionData>;
    Task: Table<TaskData>;
    Outcome: Table<OutcomeData>;
    Gate: Table<GateData>;
    Incident: Table<IncidentData>;
    Effect: Table<EffectData>;
    SlotRequirement: Table<SlotRequirementData>;
    GlobalEvent: Table<EventData>;
    MissionEvent: Table<EventData>;
    Conversation: Table<ConversationData>;
    ConversationPool: Table<WeightedPoolData>;
    AgentLevel: Table<AgentLevelData>;
    PlayerLevel: Table<PlayerLevelData>;
    Employment: Table<EmploymentData>;
    AgentPool: Table<WeightedPoolData>;
    RewardPool: Table<WeightedPoolData>;
    MissionFeed: Table<MissionFeedData>;
    MissionPool: Table<WeightedPoolData>;
    GlobalEventFeed: Table<GlobalEventFeedData>;
    GlobalEventPool: Table<WeightedPoolData>;
    MissionEventPool: Table<WeightedPoolData>;
    MissionDifficulty: Table<MissionDifficultyData>;
    MissionPenalty: Table<MissionPenaltyData>;
    PenaltyPool: Table<WeightedPoolData>;
    Penalty: Table<PenaltyData>;
    Tag: Table<TagEntry>;
    ItemType: Table<VocabularyEntry>;
    ItemSize: Table<VocabularyEntry>;
    MissionType: Table<VocabularyEntry>;
    TaskType: Table<VocabularyEntry>;
    OutcomeType: Table<VocabularyEntry>;
    IncidentType: Table<VocabularyEntry>;
    EffectType: Table<VocabularyEntry>;
    PenaltyType: Table<VocabularyEntry>;
    SkillType: Table<VocabularyEntry>;
    PriorityType: Table<VocabularyEntry>;
    LocationType: Table<VocabularyEntry>;
    ConditionType: Table<VocabularyEntry>;
    GlobalConfig: Table<GlobalConfigData>;
}

/** A partial workbook: any subset of tabs, each any subset of rows. Mocks are written like this. */
export type TableRowMap = {
    [K in keyof GameTables]?: GameTables[K] extends Table<infer R> ? R[] : never;
};
