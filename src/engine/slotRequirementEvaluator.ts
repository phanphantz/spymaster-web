import { StatContainer, hasMinStats } from './container';
import type { AgentSlotAssignment } from './gateContext';
import type { SlotRequirementData } from './types';

/**
 * Whether an agent may be placed in a slot.
 *
 * Port of `Assets/Scripts/Spymaster/Missions/SlotRequirementEvaluator.cs`. The minimums here are
 * checked against **one agent**, unlike a Gate's minimums, which are the party summed.
 */

export type IneligibilityReason =
    | { kind: 'level'; required: number; actual: number }
    | { kind: 'stat'; stat: string; required: number; actual: number }
    | { kind: 'missingTag'; tag: string }
    | { kind: 'excludedTag'; tag: string };

/** An unfilled slot passes only when it was optional to begin with. */
export function matches(
    requirement: SlotRequirementData | undefined,
    assignment: AgentSlotAssignment | undefined,
): boolean {
    if (!requirement) return true;
    if (!assignment) return !requirement.isMandatory;
    return isEligible(requirement, assignment);
}

export function isEligible(
    requirement: SlotRequirementData | undefined,
    assignment: AgentSlotAssignment | undefined,
): boolean {
    return explain(requirement, assignment).length === 0;
}

/**
 * Every reason this agent cannot take this slot.
 *
 * The Unity version returns a bare boolean. The extra detail exists for the Loadout page: telling
 * the player *why* somebody is greyed out is most of what makes slot requirements readable, and it
 * costs nothing to compute here rather than reimplementing the checks in the UI.
 */
export function explain(
    requirement: SlotRequirementData | undefined,
    assignment: AgentSlotAssignment | undefined,
): IneligibilityReason[] {
    if (!requirement || !assignment) return [];

    const reasons: IneligibilityReason[] = [];

    const minLevel = requirement.minLevel ?? 0;
    if (assignment.level < minLevel) {
        reasons.push({ kind: 'level', required: minLevel, actual: assignment.level });
    }

    if (hasMinStats(requirement)) {
        const required = StatContainer.fromColumns(requirement);
        for (const [stat, needed] of required.entries) {
            const actual = assignment.stats.get(stat);
            if (actual < needed) reasons.push({ kind: 'stat', stat, required: needed, actual });
        }
    }

    for (const tag of requirement.tags ?? []) {
        if (tag && !assignment.tags.includes(tag)) reasons.push({ kind: 'missingTag', tag });
    }

    // A hard reject: the prohibited-agent case, same weight as a missing requirement.
    for (const tag of requirement.excludedTags ?? []) {
        if (tag && assignment.tags.includes(tag)) reasons.push({ kind: 'excludedTag', tag });
    }

    return reasons;
}

/** One short line per reason, for the Loadout page. */
export function describeReason(reason: IneligibilityReason): string {
    switch (reason.kind) {
        case 'level':
            return `Needs level ${reason.required} (is ${reason.actual})`;
        case 'stat':
            return `Needs ${reason.stat.toUpperCase()} ${reason.required} (has ${reason.actual})`;
        case 'missingTag':
            return `Needs to be ${reason.tag}`;
        case 'excludedTag':
            return `Cannot be ${reason.tag}`;
    }
}
