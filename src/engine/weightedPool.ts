import type { Rng } from './rng';
import type { WeightedPoolData, WeightedPoolEntry } from './types';

/**
 * Draws from a weighted pool.
 *
 * Port of `Assets/Scripts/Spymaster/Core/Data/WeightedPool.cs`. Weights are plain integers and an
 * entry's real chance is its weight over the pool's summed weight — there is no rarity curve hiding
 * in here. Rarity is what an agent *is*; weight is how often they are offered, and the two are set
 * independently.
 */

/** An entry authored for a different character is skipped, so a pool can read differently per agent. */
function matchesCharacter(entry: WeightedPoolEntry, assignedCharacterId?: string): boolean {
    return !entry.characterId || entry.characterId === assignedCharacterId;
}

function candidatesOf(
    pool: WeightedPoolData | undefined,
    assignedCharacterId?: string,
): WeightedPoolEntry[] {
    return (pool?.entries ?? []).filter(
        (entry) =>
            entry && (entry.weight ?? 0) > 0 && entry.entryId && matchesCharacter(entry, assignedCharacterId),
    );
}

export function totalWeight(
    pool: WeightedPoolData | undefined,
    assignedCharacterId?: string,
): number {
    return candidatesOf(pool, assignedCharacterId).reduce(
        (total, entry) => total + (entry.weight ?? 0),
        0,
    );
}

export function draw(
    pool: WeightedPoolData | undefined,
    rng: Rng,
    assignedCharacterId?: string,
): WeightedPoolEntry | undefined {
    const candidates = candidatesOf(pool, assignedCharacterId);
    const total = candidates.reduce((sum, entry) => sum + (entry.weight ?? 0), 0);
    if (total <= 0) return undefined;

    let roll = rng.next(total);
    for (const candidate of candidates) {
        roll -= candidate.weight ?? 0;
        if (roll < 0) return candidate;
    }

    return candidates[candidates.length - 1];
}

/**
 * Draws `count` distinct entries, without replacement.
 *
 * Employment needs this — offering the same agent twice in one shortlist would be a bug rather than
 * bad luck — and the Unity code has no equivalent yet because Employment is still deferred there.
 */
export function drawDistinct(
    pool: WeightedPoolData | undefined,
    count: number,
    rng: Rng,
): WeightedPoolEntry[] {
    const remaining = candidatesOf(pool).slice();
    const picked: WeightedPoolEntry[] = [];

    while (picked.length < count && remaining.length) {
        const total = remaining.reduce((sum, entry) => sum + (entry.weight ?? 0), 0);
        if (total <= 0) break;

        let roll = rng.next(total);
        let index = remaining.length - 1;
        for (let i = 0; i < remaining.length; i++) {
            roll -= remaining[i].weight ?? 0;
            if (roll < 0) {
                index = i;
                break;
            }
        }

        picked.push(remaining[index]);
        remaining.splice(index, 1);
    }

    return picked;
}
