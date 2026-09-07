import { Inventory } from './container';
import type { GateContext } from './gateContext';
import type { LiveMission } from './missionFeed';
import type { Rng } from './rng';
import * as runtimeAgent from './runtimeAgent';
import type { RuntimeAgent } from './runtimeAgent';
import { Shop } from './shop';
import * as slotRequirement from './slotRequirementEvaluator';
import type { IneligibilityReason } from './slotRequirementEvaluator';
import type { GameTables, SlotRequirementData } from './types';

/**
 * The Loadout page: who goes, and what they carry.
 *
 * Port of `Assets/Scripts/Spymaster/Missions/Loadout/LoadoutSession.cs`.
 *
 * Two things here are easy to get wrong and matter a lot:
 *
 * - **A Mission has no slot list of its own.** The slots are whatever its start Gate names, in
 *   authored order. Modelling them on the Mission diverges from the data model immediately.
 * - **Items are moved, not marked.** Assigning transfers stock out of the player's inventory into
 *   the agent's carried inventory, and unassigning, swapping or cancelling transfers it back — so an
 *   abandoned Loadout leaves nothing stranded.
 */

export interface LoadoutSlot {
    slotId: string;
    requirement?: SlotRequirementData;
    isMandatory: boolean;
}

export interface AgentEligibility {
    agent: RuntimeAgent;
    isEligible: boolean;
    reasons: IneligibilityReason[];
}

export class LoadoutSession {
    readonly slots: LoadoutSlot[];
    readonly shop: Shop;

    /** slotId to characterId. */
    private readonly assigned = new Map<string, string>();
    /** characterId to what that agent is carrying. */
    private readonly carried = new Map<string, Inventory>();

    constructor(
        readonly mission: LiveMission,
        private readonly tables: GameTables,
        private readonly roster: readonly RuntimeAgent[],
        private readonly inventory: Inventory,
        playerLevel: number,
    ) {
        const startGate = tables.Gate.get(mission.data.gateId);
        this.slots = (startGate?.slotReqIds ?? []).map((slotId) => {
            const requirement = tables.SlotRequirement.get(slotId);
            return {
                slotId: requirement?.slotId ?? slotId,
                requirement,
                // An unauthored requirement is treated as a plain slot rather than a locked one.
                isMandatory: requirement?.isMandatory ?? true,
            };
        });

        this.shop = new Shop(tables.Item, inventory, playerLevel);
    }

    get assignments(): ReadonlyMap<string, string> {
        return this.assigned;
    }

    agentIn(slotId: string): RuntimeAgent | undefined {
        const characterId = this.assigned.get(slotId);
        return characterId ? this.roster.find((agent) => agent.characterId === characterId) : undefined;
    }

    slotOf(characterId: string): string | undefined {
        for (const [slotId, assigned] of this.assigned) {
            if (assigned === characterId) return slotId;
        }
        return undefined;
    }

    /**
     * Everyone who could take this slot, and why the rest cannot.
     *
     * Somebody already standing in another slot of this same page is offered as ineligible rather
     * than hidden, because "she is already on this job" is a more useful thing to read than an
     * absence.
     */
    candidatesFor(slotId: string): AgentEligibility[] {
        const slot = this.slots.find((candidate) => candidate.slotId === slotId);

        return this.roster.map((agent) => {
            const assignment = runtimeAgent.toSlotAssignment(agent, slotId);
            const reasons = slotRequirement.explain(slot?.requirement, assignment);
            const isAvailable = runtimeAgent.isAvailable(agent);
            return { agent, isEligible: isAvailable && reasons.length === 0, reasons };
        });
    }

    /**
     * Places an agent in a slot.
     *
     * Moving an agent between slots on the same page keeps what they are carrying. Anyone they
     * displace has their items returned to the pool, so nothing is left held by somebody who is no
     * longer going.
     */
    assignAgent(slotId: string, characterId: string): boolean {
        const slot = this.slots.find((candidate) => candidate.slotId === slotId);
        if (!slot) return false;

        const agent = this.roster.find((candidate) => candidate.characterId === characterId);
        if (!agent || !runtimeAgent.isAvailable(agent)) return false;

        if (!slotRequirement.isEligible(slot.requirement, runtimeAgent.toSlotAssignment(agent, slotId))) {
            return false;
        }

        const previousSlot = this.slotOf(characterId);
        if (previousSlot) this.assigned.delete(previousSlot);

        const displaced = this.assigned.get(slotId);
        if (displaced && displaced !== characterId) this.returnCarried(displaced);

        this.assigned.set(slotId, characterId);
        return true;
    }

    unassignAgent(slotId: string): void {
        const characterId = this.assigned.get(slotId);
        if (!characterId) return;

        this.assigned.delete(slotId);
        this.returnCarried(characterId);
    }

    carriedBy(characterId: string): Inventory {
        let inventory = this.carried.get(characterId);
        if (!inventory) {
            inventory = new Inventory();
            this.carried.set(characterId, inventory);
        }
        return inventory;
    }

    /** Item slots left on this agent. Capacity is fixed per agent, not per level. */
    remainingCapacity(characterId: string): number {
        const agent = this.roster.find((candidate) => candidate.characterId === characterId);
        if (!agent) return 0;
        return Math.max(0, runtimeAgent.inventorySize(agent) - this.carriedBy(characterId).total);
    }

    /** Transfers stock out of the player's inventory. Refuses rather than over-filling a slot. */
    assignItem(characterId: string, itemId: string, qty = 1): boolean {
        if (!this.slotOf(characterId)) return false;
        if (this.remainingCapacity(characterId) < qty) return false;
        if (this.inventory.get(itemId) < qty) return false;

        return this.inventory.transferTo(this.carriedBy(characterId), itemId, qty) === qty;
    }

    unassignItem(characterId: string, itemId: string, qty = 1): boolean {
        return this.carriedBy(characterId).transferTo(this.inventory, itemId, qty) > 0;
    }

    /** Mandatory slots still empty. Confirming is blocked while this is non-empty and nothing else. */
    get missingMandatorySlots(): LoadoutSlot[] {
        return this.slots.filter((slot) => slot.isMandatory && !this.assigned.has(slot.slotId));
    }

    get canConfirm(): boolean {
        return this.missingMandatorySlots.length === 0;
    }

    /** Everything carried by everyone going, as one pool — which is how a Gate reads items. */
    private pooledItems(): Inventory {
        const pooled = new Inventory();
        for (const characterId of this.assigned.values()) {
            for (const [itemId, qty] of this.carriedBy(characterId).entries) pooled.add(itemId, qty);
        }
        return pooled;
    }

    /**
     * Builds the state a Gate is checked against.
     *
     * Assignments come out in slot order, so a Gate reading them sees the Loadout the way it was
     * authored rather than the order the player happened to fill it in.
     */
    buildContext(rng: Rng): GateContext {
        const assignments = this.slots
            .map((slot) => {
                const agent = this.agentIn(slot.slotId);
                return agent ? runtimeAgent.toSlotAssignment(agent, slot.slotId) : undefined;
            })
            .filter((assignment): assignment is NonNullable<typeof assignment> => assignment !== undefined);

        return {
            gates: this.tables.Gate,
            slotRequirements: this.tables.SlotRequirement,
            outcomes: this.tables.Outcome,
            assignments,
            carriedItems: this.pooledItems(),
            rng,
        };
    }

    /**
     * Hands back the context, without sending anyone.
     *
     * Deployment is the caller's decision. Keeping them separate is what makes a backed-out Loadout
     * cost nothing.
     */
    confirm(rng: Rng): GateContext | undefined {
        return this.canConfirm ? this.buildContext(rng) : undefined;
    }

    /** Returns every carried item and clears the page. */
    cancel(): void {
        for (const characterId of [...this.carried.keys()]) this.returnCarried(characterId);
        this.assigned.clear();
    }

    private returnCarried(characterId: string): void {
        this.carried.get(characterId)?.transferAllTo(this.inventory);
    }
}
