import type { LiveMission } from './missionFeed';
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
