/**
 * A seeded random source, matching the surface of the `System.Random` the Unity code passes around.
 *
 * Every draw in the engine takes one of these rather than reaching for `Math.random`, so a run can
 * be replayed exactly: the same seed and the same choices produce the same missions, the same
 * employment offer, and the same `luckRoll`. That is the only way to tell a balance change from a
 * bad roll.
 */
export interface Rng {
    /** Uniform in [0, maxExclusive). */
    next(maxExclusive: number): number;
    /** Uniform integer in [minInclusive, maxExclusive). */
    range(minInclusive: number, maxExclusive: number): number;
    /** Uniform in [0, 1). */
    nextDouble(): number;
}

/**
 * mulberry32. Small, fast, and good enough for gameplay draws — it is not a cryptographic source
 * and nothing here should treat it as one.
 */
export function createRng(seed: number): Rng {
    let state = seed >>> 0;

    const nextDouble = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    return {
        nextDouble,
        next: (maxExclusive) => (maxExclusive <= 0 ? 0 : Math.floor(nextDouble() * maxExclusive)),
        range: (minInclusive, maxExclusive) =>
            maxExclusive <= minInclusive
                ? minInclusive
                : minInclusive + Math.floor(nextDouble() * (maxExclusive - minInclusive)),
    };
}

/** A seed derived from the clock, for a fresh run nobody asked to reproduce. */
export function randomSeed(): number {
    return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
