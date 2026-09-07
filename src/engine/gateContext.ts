import { Inventory, StatContainer } from './container';
import type { Rng } from './rng';
import type { GateData, SlotRequirementData, OutcomeData, Table } from './types';

/**
 * One agent placed in one Mission slot, flattened to just what a Gate reads.
 *
 * Port of `AgentSlotAssignment` in `Assets/Scripts/Spymaster/Missions/GateContext.cs`. Stats are the
 * agent's effective values — authored base plus points spent on level-up.
 */
export interface AgentSlotAssignment {
    slotId: string;
    characterId: string;
    level: number;
    stats: StatContainer;
    skillIds: string[];
    tags: string[];
}

export function hasSkill(assignment: AgentSlotAssignment | undefined, skillId: string): boolean {
    return assignment?.skillIds.includes(skillId) ?? false;
}

export function hasTag(assignment: AgentSlotAssignment | undefined, tag: string): boolean {
    return assignment?.tags.includes(tag) ?? false;
}

/** The same agent, placed in a different slot. Stats, skills and tags are shared, not copied. */
export function forSlot(
    assignment: AgentSlotAssignment,
    slotId: string,
): AgentSlotAssignment {
    return { ...assignment, slotId };
}

/**
 * The state a Gate is checked against: who is assigned, what they are carrying between them, and the
 * random source a `luckRoll` uses.
 */
export interface GateContext {
    gates: Table<GateData>;
    slotRequirements: Table<SlotRequirementData>;
    outcomes: Table<OutcomeData>;

    assignments: AgentSlotAssignment[];

    /** Items the assigned agents are carrying into this story point, pooled. */
    carriedItems: Inventory;

    /** Injected so a luckRoll is reproducible in a test and in a replayed run. */
    rng: Rng;
}

/**
 * Combined Stats of every assigned agent — what a Gate's minimums are measured against.
 *
 * Note the scope: this is the *party* sum. A SlotRequirement's minimums, which wear the same six
 * column names, are checked against one agent alone.
 */
export function partyStats(context: GateContext): StatContainer {
    const summed = StatContainer.sum(context.assignments.map((assignment) => assignment.stats));
    // Container.sum returns the base class; the stat accessors want the subclass.
    return new StatContainer(summed.entries);
}

/** A required Skill is satisfied when any assigned agent owns it. No Stat substitutes for one. */
export function partyHasSkill(context: GateContext, skillId: string): boolean {
    if (!skillId) return false;
    return context.assignments.some((assignment) => assignment.skillIds.includes(skillId));
}

export function getAssignment(
    context: GateContext,
    slotId: string | undefined,
): AgentSlotAssignment | undefined {
    if (!slotId) return undefined;
    return context.assignments.find((assignment) => assignment.slotId === slotId);
}
