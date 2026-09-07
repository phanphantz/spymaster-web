import { Inventory, StatContainer, hasMinStats } from './container';
import { getAssignment, partyHasSkill, partyStats, type GateContext } from './gateContext';
import * as slotRequirement from './slotRequirementEvaluator';
import { CONDITION_LUCK_ROLL, type GateCondition, type GateData } from './types';

/**
 * Checks a Gate against a GateContext.
 *
 * Port of `Assets/Scripts/Spymaster/Missions/GateEvaluator.cs`. Conditions combine with AND — never
 * a partial match — and every field is a deterministic state check except a `luckRoll`.
 *
 * There is deliberately no scoring here. Difficulty lives entirely in how tightly each Outcome
 * tier's Gate is authored, so nothing about a Mission's difficulty level reaches this code. Adding
 * a modifier, a weight, or a success percentage would resurrect exactly the layer the design
 * removed from the schema.
 */

/** True when a Gate asks for nothing at all — which is what makes the fallback tier guaranteed. */
export function isEmpty(gate: GateData | undefined): boolean {
    if (!gate) return true;

    return (
        !hasMinStats(gate) &&
        !gate.slotReqIds?.length &&
        !gate.conditions?.length &&
        !gate.reqItems?.length &&
        !gate.reqSkillIds?.length
    );
}

export function matches(gate: GateData | undefined, context: GateContext | undefined): boolean {
    // An unauthored or empty Gate always matches.
    if (isEmpty(gate)) return true;
    if (!context) return false;

    return (
        matchesStats(gate!, context) &&
        matchesSlots(gate!, context) &&
        matchesItems(gate!, context) &&
        matchesSkills(gate!, context) &&
        matchesConditions(gate!, context)
    );
}

function matchesStats(gate: GateData, context: GateContext): boolean {
    if (!hasMinStats(gate)) return true;
    return partyStats(context).hasEnough(StatContainer.fromColumns(gate)).hasEnough;
}

function matchesSlots(gate: GateData, context: GateContext): boolean {
    if (!gate.slotReqIds?.length) return true;

    for (const slotReqId of gate.slotReqIds) {
        const requirement = context.slotRequirements.get(slotReqId);
        // An unauthored requirement id is skipped rather than failed: the slot simply has no rules
        // yet, which is a data gap, not a locked door.
        if (!requirement) continue;

        if (!slotRequirement.matches(requirement, getAssignment(context, requirement.slotId))) {
            return false;
        }
    }

    return true;
}

function matchesItems(gate: GateData, context: GateContext): boolean {
    if (!gate.reqItems?.length) return true;

    const carried = context.carriedItems ?? new Inventory();
    for (const required of gate.reqItems) {
        if (!required?.itemId) continue;
        // Items are pooled across the whole party, so any agent may be the one carrying it.
        if (carried.get(required.itemId) < (required.qty ?? 0)) return false;
    }

    return true;
}

function matchesSkills(gate: GateData, context: GateContext): boolean {
    if (!gate.reqSkillIds?.length) return true;

    for (const skillId of gate.reqSkillIds) {
        if (skillId && !partyHasSkill(context, skillId)) return false;
    }

    return true;
}

function matchesConditions(gate: GateData, context: GateContext): boolean {
    if (!gate.conditions?.length) return true;

    for (const condition of gate.conditions) {
        if (!condition?.conditionId) continue;
        if (!matchesCondition(gate, condition, context)) return false;
    }

    return true;
}

function matchesCondition(
    gate: GateData,
    condition: GateCondition,
    context: GateContext,
): boolean {
    if (condition.conditionId === CONDITION_LUCK_ROLL) return rollLuck(condition, context);

    // The rest of the ConditionType vocabulary is deferred by design. Treat anything else as unmet
    // rather than silently passing a Gate nobody has implemented.
    console.warn(
        `[GateEvaluator] Gate "${gate.gateId}" uses unknown conditionId ` +
            `"${condition.conditionId}". Treated as unmet.`,
    );
    return false;
}

/**
 * A flat authored probability, rolled fresh on every check and AND-combined with the Gate's other
 * conditions.
 *
 * Never derived from a Stat — that would be a scoring formula in disguise, and it is the reason the
 * weighted-difficulty model was dropped. It also never belongs on the critical-failure fallback,
 * which has to stay guaranteed; a bad roll there would leave a story point with no matching Outcome
 * at all.
 */
function rollLuck(condition: GateCondition, context: GateContext): boolean {
    const probability = Number(condition.conditionValue);

    if (!Number.isFinite(probability)) {
        console.warn(
            `[GateEvaluator] luckRoll value "${condition.conditionValue}" is not a number. ` +
                'Treated as unmet.',
        );
        return false;
    }

    if (probability <= 0) return false;
    if (probability >= 1) return true;

    return context.rng.nextDouble() < probability;
}
