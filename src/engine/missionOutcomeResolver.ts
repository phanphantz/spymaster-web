import * as gateEvaluator from './gateEvaluator';
import type { GateContext } from './gateContext';
import type { MissionData, OutcomeData, StoryPointData } from './types';

/**
 * Picks which Outcome a Mission resolves to: walk its ordered Outcome list top to bottom and stop at
 * the first Gate that matches.
 *
 * Port of `Assets/Scripts/Spymaster/Missions/MissionOutcomeResolver.cs`.
 *
 * That is the whole mechanism. Nothing is scored, no chance is computed, and no percentage is ever
 * shown to the player because none exists. Both halves of the design intent fall out of the ordering
 * itself: an agent seriously lacking a requirement clears nothing above the critical-failure
 * fallback, while an under-prepared one still clears some looser lower tier and lands there —
 * damaged and routed down a longer path, not ended.
 */

/**
 * The Mission-level Gate, checked once before the Mission may start.
 *
 * It has no bearing on the result. Its other job — the one that matters most in practice — is that
 * its `slotReqIds` are what enumerate the Loadout's slots, because a Mission has no slot list of its
 * own.
 */
export function canStart(mission: MissionData | undefined, context: GateContext): boolean {
    if (!mission) return false;
    return gateEvaluator.matches(context.gates.get(mission.gateId), context);
}

/** Resolves a story point's Outcome ids through the Outcome table, then selects the first match. */
export function resolve(
    storyPoint: StoryPointData | undefined,
    context: GateContext,
): OutcomeData | undefined {
    if (!storyPoint) return undefined;
    return selectOutcome(context.outcomes.getMany(storyPoint.outcomes), context);
}

/**
 * Selects the first Outcome in authored order whose Gate matches.
 *
 * Returns undefined only when nothing is authored — a correctly authored list ends in a
 * critical-failure tier whose empty Gate always matches.
 */
export function selectOutcome(
    orderedOutcomes: readonly OutcomeData[],
    context: GateContext,
): OutcomeData | undefined {
    for (const outcome of orderedOutcomes) {
        if (!outcome) continue;
        if (gateEvaluator.matches(context.gates.get(outcome.gateId), context)) return outcome;
    }

    return undefined;
}
