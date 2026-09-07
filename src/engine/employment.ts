import type { Rng } from './rng';
import { createAgent, type RuntimeAgent } from './runtimeAgent';
import * as weightedPool from './weightedPool';
import type { EmploymentData, GameTables } from './types';

/**
 * Employment: the player picks a roster out of a larger shortlist.
 *
 * No Unity counterpart — Employment is deferred there, with a serialised list of starting character
 * ids standing in. Written here to be ported across.
 *
 * It is a reward phase, not a purchase: there is no hiring cost anywhere in the design, and money
 * never enters recruitment. Rarity is what an agent *is*; pool weight is how often they are
 * offered, and the two are set independently.
 */

export interface EmploymentOffer {
    feedId: string;
    /** How many of the candidates the player keeps. */
    pickQty: number;
    /** The shortlist, already drawn. Distinct — the same agent is never offered twice. */
    candidates: RuntimeAgent[];
}

/** The Employment row for this player level: the highest requirement they have reached. */
export function selectEmployment(
    tables: GameTables,
    playerLevel: number,
): EmploymentData | undefined {
    let best: EmploymentData | undefined;

    for (const row of tables.Employment.rows) {
        const required = row.reqPlayerLevel ?? 0;
        if (required > playerLevel) continue;
        if (!best || required > (best.reqPlayerLevel ?? 0)) best = row;
    }

    return best;
}

/**
 * Draws the shortlist.
 *
 * The offer size is the summed `qty` across the row's pools. Draws are distinct, because offering
 * the same agent twice in one shortlist reads as a bug rather than as bad luck.
 */
export function rollOffer(
    tables: GameTables,
    playerLevel: number,
    rng: Rng,
): EmploymentOffer | undefined {
    const employment = selectEmployment(tables, playerLevel);
    if (!employment) return undefined;

    const candidates: RuntimeAgent[] = [];
    const taken = new Set<string>();

    for (const draw of employment.pools ?? []) {
        if (!draw.poolId) continue;

        const pool = tables.AgentPool.get(draw.poolId);
        if (!pool) continue;

        // Ask for more than needed so agents already drawn from an earlier pool can be skipped
        // without the shortlist coming up short.
        const wanted = draw.qty ?? 0;
        const drawn = weightedPool.drawDistinct(pool, wanted + taken.size, rng);

        for (const entry of drawn) {
            if (candidates.length >= totalOfferSize(employment)) break;
            if (!entry.entryId || taken.has(entry.entryId)) continue;

            const data = tables.AgentData.get(entry.entryId);
            if (!data) continue;

            taken.add(entry.entryId);
            candidates.push(createAgent(data, tables.CharacterData.get(entry.entryId)));
        }
    }

    return {
        feedId: employment.feedId ?? '',
        pickQty: Math.max(1, employment.pickQty ?? 1),
        candidates,
    };
}

function totalOfferSize(employment: EmploymentData): number {
    return (employment.pools ?? []).reduce((total, draw) => total + (draw.qty ?? 0), 0);
}
