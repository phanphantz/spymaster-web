import { STAT_IDS, type StatColumns, type StatId } from './types';

/**
 * A bag of named amounts, and the two things built on it: an Inventory of Items and a StatContainer
 * of Stats.
 *
 * Port of `Assets/Scripts/Core/Container.cs` and `NamedValue.cs`. Two behaviours are load-bearing
 * and easy to lose in a rewrite:
 *
 * - **A value never goes negative.** Setting below zero clamps at zero, so a failed removal cannot
 *   leave a debt behind.
 * - **A missing entry counts as zero.** `hasEnough` on an id nobody holds is a clean "no", not a
 *   crash, which is what lets a Gate ask for an Item the player has never owned.
 */
export class Container {
    private readonly values = new Map<string, number>();

    constructor(entries?: Iterable<readonly [string, number]>) {
        if (entries) {
            for (const [id, value] of entries) this.set(id, value);
        }
    }

    get ids(): string[] {
        return [...this.values.keys()];
    }

    get entries(): [string, number][] {
        return [...this.values.entries()];
    }

    get isEmpty(): boolean {
        return this.values.size === 0;
    }

    get(id: string): number {
        return this.values.get(id) ?? 0;
    }

    /** Clamps at zero, and drops the entry entirely when it lands there. */
    set(id: string, value: number): this {
        if (!id) return this;

        const clamped = Math.max(0, value);
        if (clamped === 0) this.values.delete(id);
        else this.values.set(id, clamped);
        return this;
    }

    add(id: string, amount: number): this {
        return this.set(id, this.get(id) + amount);
    }

    /** Removes as much as is asked for, and reports whether all of it was there. */
    remove(id: string, amount: number): boolean {
        const current = this.get(id);
        if (current < amount) return false;

        this.set(id, current - amount);
        return true;
    }

    /** Moves `min(amount, available)` and returns how much actually moved. */
    transferTo(target: Container, id: string, amount: number): number {
        const moved = Math.min(Math.max(0, amount), this.get(id));
        if (moved <= 0) return 0;

        this.set(id, this.get(id) - moved);
        target.add(id, moved);
        return moved;
    }

    /** Moves everything to `target`, leaving this container empty. */
    transferAllTo(target: Container): void {
        for (const [id, value] of this.entries) {
            this.set(id, 0);
            target.add(id, value);
        }
    }

    hasEnough(required: Container): { hasEnough: boolean; missing: [string, number][] } {
        const missing: [string, number][] = [];

        for (const [id, needed] of required.entries) {
            const shortfall = needed - this.get(id);
            if (shortfall > 0) missing.push([id, shortfall]);
        }

        return { hasEnough: missing.length === 0, missing };
    }

    /** Total across every entry. Used for item slot occupancy. */
    get total(): number {
        let sum = 0;
        for (const value of this.values.values()) sum += value;
        return sum;
    }

    clone(): Container {
        return new Container(this.entries);
    }

    static sum(containers: readonly (Container | undefined)[]): Container {
        const result = new Container();
        for (const container of containers) {
            if (!container) continue;
            for (const [id, value] of container.entries) result.add(id, value);
        }
        return result;
    }
}

/** Items the player or an agent is holding. Money is one of them. */
export class Inventory extends Container {}

/** The six Stats. Health is tracked separately, on the agent. */
export class StatContainer extends Container {
    /** Reads the six stat columns off any row that carries them, skipping unauthored zeroes. */
    static fromColumns(columns: StatColumns | undefined): StatContainer {
        const stats = new StatContainer();
        if (!columns) return stats;

        for (const stat of STAT_IDS) {
            const value = columns[stat];
            // A blank or zero column means "no value authored", not "requires zero".
            if (typeof value === 'number' && value > 0) stats.set(stat, value);
        }
        return stats;
    }

    statValue(stat: StatId): number {
        return this.get(stat);
    }
}

/** True when a row carries at least one authored stat minimum. */
export function hasMinStats(columns: StatColumns | undefined): boolean {
    return !StatContainer.fromColumns(columns).isEmpty;
}
