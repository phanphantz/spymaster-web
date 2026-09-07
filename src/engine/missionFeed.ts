import * as weightedPool from './weightedPool';
import type { Rng } from './rng';
import type {
    GameTables,
    LocationData,
    MissionData,
    MissionFeedData,
    Table,
    WeightedPoolData,
} from './types';
import { PLACEHOLDER_LOCATION } from './types';

/**
 * How Missions arrive on the World Map.
 *
 * Port of `MissionFeedState.cs`, `MissionFeedRuntime.cs` and `MissionGenerator.cs`.
 *
 * The shape worth preserving: **every draw happens once, when the Feed takes over.** Quotas are
 * spent building an ordered plan, so what comes next is inspectable long before it arrives instead
 * of being decided the moment it appears. Only the interval between releases is rolled as the Feed
 * runs.
 */

/** How far ahead a Feed with an unlimited pool is planned, so there is always a queue to read. */
export const UNLIMITED_LOOKAHEAD = 10;

export interface PlannedMissionRelease {
    poolId: string;
    missionId: string;
}

export class MissionFeedState {
    private readonly unplannedByPool = new Map<string, number>();
    private readonly unlimitedPools: string[] = [];
    private readonly plan: PlannedMissionRelease[] = [];

    private releasedCount = 0;
    private nextReleaseMinute: number;

    constructor(
        readonly feed: MissionFeedData,
        rng: Rng,
        currentMinute: number,
        private readonly drawMissionFromPool: (poolId: string, rng: Rng) => string | undefined,
    ) {
        for (const draw of feed?.pools ?? []) {
            if (!draw?.poolId) continue;

            const qty = draw.qty ?? 0;
            if (qty > 0) {
                this.unplannedByPool.set(draw.poolId, (this.unplannedByPool.get(draw.poolId) ?? 0) + qty);
            } else if (!this.unlimitedPools.includes(draw.poolId)) {
                this.unlimitedPools.push(draw.poolId);
            }
        }

        this.replan(rng);

        // The first release is due the moment the Feed takes over; the interval only spaces out the
        // ones after it, so starting a run is not a wait before anything appears.
        this.nextReleaseMinute = currentMinute;
    }

    get feedId(): string | undefined {
        return this.feed?.feedId;
    }

    /** Missions that may sit unanswered at once. 0 means no cap. */
    get activeCap(): number {
        return (this.feed?.maxActiveCount ?? 0) > 0 ? this.feed.maxActiveCount! : 0;
    }

    get released(): number {
        return this.releasedCount;
    }

    get dueAtMinute(): number {
        return this.nextReleaseMinute;
    }

    /** What this Feed will release, in order. Drawn up front, so it can be read ahead of time. */
    get upcoming(): readonly PlannedMissionRelease[] {
        return this.plan;
    }

    get next(): PlannedMissionRelease | undefined {
        return this.plan[0];
    }

    /** True once the plan is empty and cannot be topped up — every pool's quota is used. */
    get isSpent(): boolean {
        return this.plan.length === 0;
    }

    /**
     * Whether a release is due, given how many Missions are already sitting unanswered.
     *
     * Being held back by the cap deliberately does not spend the Feed: the plan is untouched and the
     * same mission is still next when a slot frees up.
     */
    isDue(minute: number, pendingCount: number): boolean {
        if (this.isSpent || minute < this.nextReleaseMinute) return false;
        return this.activeCap <= 0 || pendingCount < this.activeCap;
    }

    /** Takes the next planned Mission off the plan, tops the plan up, and schedules the one after. */
    takeNext(minute: number, rng: Rng): PlannedMissionRelease | undefined {
        const planned = this.plan.shift();
        if (!planned) return undefined;

        this.releasedCount++;
        this.replan(rng);
        this.scheduleNextRelease(minute, rng);
        return planned;
    }

    /**
     * Pushes the next release out by a rolled interval. Also used when a release is skipped, so a
     * Feed held back by the Mission cap retries on its own rhythm rather than every minute.
     */
    scheduleNextRelease(minute: number, rng: Rng): void {
        this.nextReleaseMinute = minute + this.rollInterval(rng);
    }

    /**
     * Fills the plan up to the length this Feed is allowed. A pool that cannot produce a Mission —
     * no rows, or every entry weightless — is dropped rather than retried, so planning always ends.
     */
    private replan(rng: Rng): void {
        while (this.plan.length < this.planLength()) {
            const poolId = this.drawPoolId(rng);
            if (!poolId) return;

            const missionId = this.drawMissionFromPool(poolId, rng);
            if (!missionId) {
                this.unplannedByPool.delete(poolId);
                const index = this.unlimitedPools.indexOf(poolId);
                if (index >= 0) this.unlimitedPools.splice(index, 1);
                continue;
            }

            const unplanned = this.unplannedByPool.get(poolId) ?? 0;
            if (unplanned > 0) this.unplannedByPool.set(poolId, unplanned - 1);

            this.plan.push({ poolId, missionId });
        }
    }

    /**
     * How long the plan may be: every point of quota the pools have left, or — for a Feed with an
     * unlimited pool, which could otherwise be planned forever — the lookahead.
     */
    private planLength(): number {
        if (this.unlimitedPools.length) return UNLIMITED_LOOKAHEAD;

        let unplanned = 0;
        for (const value of this.unplannedByPool.values()) {
            if (value > 0) unplanned += value;
        }
        return this.plan.length + unplanned;
    }

    /** Picks which pool the next planned release comes from, weighted by unplanned quota. */
    private drawPoolId(rng: Rng): string | undefined {
        let total = 0;
        for (const value of this.unplannedByPool.values()) {
            if (value > 0) total += value;
        }
        total += this.unlimitedPools.length;
        if (total <= 0) return undefined;

        let roll = rng.next(total);

        for (const [poolId, value] of this.unplannedByPool) {
            if (value <= 0) continue;
            roll -= value;
            if (roll < 0) return poolId;
        }

        for (const poolId of this.unlimitedPools) {
            roll--;
            if (roll < 0) return poolId;
        }

        return undefined;
    }

    private rollInterval(rng: Rng): number {
        const min = this.feed?.minFeedIntervalMinute ?? 0;
        const max = this.feed?.maxFeedIntervalMinute ?? 0;

        let interval: number;
        if (max <= 0) interval = min;
        else if (min <= 0 || min >= max) interval = max;
        else interval = rng.range(min, max + 1);

        return interval > 0 ? interval : 1;
    }
}

/** A Mission instance on the World Map. Two instances of one blueprint share a missionId. */
export interface LiveMission {
    /** The identity. `missionId#n`, because missionId alone is the blueprint, not the instance. */
    instanceId: string;
    data: MissionData;
    location?: LocationData;
    feedId?: string;
    generatedAtMinute: number;
}

/**
 * Clones a blueprint into a live Mission and fills in what was left to the generator.
 *
 * Port of `MissionGenerator.cs`, with one difference: the random Location draw the Unity MVP skipped
 * is implemented here, because the seed data has Locations and the whole point of leaving a
 * blueprint's `locationId` blank is that a Mission reads as happening anywhere. A blueprint that
 * does author a Location keeps it.
 */
export function generateMission(
    blueprint: MissionData,
    locations: Table<LocationData>,
    rng: Rng,
    instanceId: string,
    generatedAtMinute: number,
): LiveMission {
    const instance: MissionData = structuredClone(blueprint);

    const location = instance.locationId
        ? locations.get(instance.locationId)
        : drawLocation(locations, rng);

    if (location?.locationId) instance.locationId = location.locationId;

    substitute(instance, location);

    return { instanceId, data: instance, location, generatedAtMinute };
}

function drawLocation(locations: Table<LocationData>, rng: Rng): LocationData | undefined {
    if (!locations.rows.length) return undefined;
    return locations.rows[rng.next(locations.rows.length)];
}

/**
 * Replaces `{variableName}` in the text fields.
 *
 * An unresolved placeholder is left standing rather than blanked, so missing data stays visible
 * instead of quietly reading as an authored gap.
 */
function substitute(mission: MissionData, location: LocationData | undefined): void {
    const name = location?.displayName;
    if (!name) return;

    for (const field of ['displayName', 'description', 'hint'] as const) {
        const value = mission[field];
        if (typeof value === 'string') {
            mission[field] = value.split(PLACEHOLDER_LOCATION).join(name);
        }
    }
}

/**
 * Chooses which Feed is running and releases from it.
 *
 * One Feed runs at a time: the one with the highest `reqPlayerLevel` the player has reached, ties
 * going to the first authored. Levelling into the next Feed hands over and plans it fresh; Missions
 * the old Feed already put on the World Map stay where they are.
 */
export class MissionFeedRuntime {
    private state?: MissionFeedState;
    private instanceCounter = 0;

    constructor(
        private readonly tables: GameTables,
        private readonly rng: Rng,
    ) {}

    get activeFeedId(): string | undefined {
        return this.state?.feedId;
    }

    get upcoming(): readonly PlannedMissionRelease[] {
        return this.state?.upcoming ?? [];
    }

    get dueAtMinute(): number | undefined {
        return this.state?.dueAtMinute;
    }

    /** Picks the Feed for this player level, replanning if it changed. */
    syncActiveFeed(playerLevel: number, minute: number): void {
        const feed = this.selectFeed(playerLevel);
        if (!feed) {
            this.state = undefined;
            return;
        }

        if (this.state?.feedId === feed.feedId) return;

        this.state = new MissionFeedState(feed, this.rng, minute, (poolId, rng) =>
            this.drawMissionId(poolId, rng),
        );
    }

    /**
     * Releases at most one Mission for this minute.
     *
     * Returns undefined when nothing was due — including when the Feed was held back by the active
     * cap, which is not the same as the Feed being spent.
     */
    evaluate(minute: number, pendingCount: number): LiveMission | undefined {
        const state = this.state;
        if (!state?.isDue(minute, pendingCount)) return undefined;

        const planned = state.takeNext(minute, this.rng);
        if (!planned) return undefined;

        const blueprint = this.tables.Mission.get(planned.missionId);
        if (!blueprint) {
            // The plan named a Mission the tables do not have. It has already been taken off the
            // plan; wait out the interval rather than spinning on the next one.
            return undefined;
        }

        this.instanceCounter++;
        const mission = generateMission(
            blueprint,
            this.tables.Location,
            this.rng,
            `${planned.missionId}#${this.instanceCounter}`,
            minute,
        );
        mission.feedId = state.feedId;
        return mission;
    }

    private selectFeed(playerLevel: number): MissionFeedData | undefined {
        let best: MissionFeedData | undefined;

        for (const feed of this.tables.MissionFeed.rows) {
            const required = feed.reqPlayerLevel ?? 0;
            if (required > playerLevel) continue;
            // Highest reached requirement wins; a tie goes to the first authored.
            if (!best || required > (best.reqPlayerLevel ?? 0)) best = feed;
        }

        return best;
    }

    private drawMissionId(poolId: string, rng: Rng): string | undefined {
        const pool: WeightedPoolData | undefined = this.tables.MissionPool.get(poolId);
        return weightedPool.draw(pool, rng)?.entryId;
    }
}
