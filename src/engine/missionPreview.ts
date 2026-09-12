import type { LoadoutSession } from './loadout';
import type { LiveMission } from './missionFeed';
import * as resolver from './missionOutcomeResolver';
import { createRng } from './rng';
import type { GameTables } from './types';

/**
 * What a mission promises before anyone commits to it — read from its best authored Outcome tier,
 * not from a live Loadout session. Shared by the World Map's row and the Mission modal's Details
 * tab, which both preview the same numbers from two different places.
 */
export function previewReward(tables: GameTables, bestOutcomeId: string | undefined): { money: number; exp: number } {
    const outcome = tables.Outcome.get(bestOutcomeId);
    const incidents = tables.Incident.getMany(outcome?.incidents);

    let money = 0;
    let exp = 0;
    for (const incident of incidents) {
        exp += incident.rewardExp ?? 0;
        for (const reward of incident.rewardItems ?? []) {
            if (reward.itemId === 'dollar') money += reward.qty ?? 0;
        }
    }

    return { money, exp };
}

/**
 * How many agents a mission's start Gate names — mirrors LoadoutSession's own slot count, without
 * standing up a session to ask (the World Map lists missions nobody has opened yet).
 */
export function slotCountFor(mission: LiveMission, tables: GameTables): { mandatory: number; total: number } {
    const ids = tables.Gate.get(mission.data.gateId)?.slotReqIds ?? [];
    const mandatory = ids.filter((id) => tables.SlotRequirement.get(id)?.isMandatory ?? true).length;
    return { mandatory, total: ids.length };
}

export type SuccessLikelihood = 'low' | 'medium' | 'high';

/** best → high, acceptable → medium, bad and criticalFailure both → low: three buckets for four
 *  tiers, since bad is already a failure to plan around, same as criticalFailure. */
const LIKELIHOOD_BY_TIER: Record<string, SuccessLikelihood> = {
    best: 'high',
    acceptable: 'medium',
    bad: 'low',
    criticalFailure: 'low',
};

/**
 * Reads Low/Medium/High off whichever Outcome tier the current Loadout would clear right now.
 *
 * This is not a percentage — `missionOutcomeResolver` deliberately computes none — it is a live
 * preview of the same deterministic Gate walk `deploy` runs, relabelled from its tier. A Gate using
 * `luckRoll` is the one non-deterministic exception, so a mission that leans on one may preview
 * differently than it resolves; that is inherent to a live read of a random condition, not a bug in
 * the preview. Undefined only when the mission has no authored Outcomes to walk at all.
 */
export function previewLikelihood(session: LoadoutSession): SuccessLikelihood | undefined {
    const context = session.buildContext(createRng(1));
    const outcome = resolver.resolve(session.mission.data, context);
    return outcome?.type ? LIKELIHOOD_BY_TIER[outcome.type] : undefined;
}
