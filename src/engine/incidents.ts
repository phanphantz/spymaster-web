import type { Inventory } from './container';
import type { Rng } from './rng';
import * as runtimeAgent from './runtimeAgent';
import type { RuntimeAgent } from './runtimeAgent';
import type { AppliedEffect, GameTables, IncidentData } from './types';

/**
 * Applies Incidents — the only thing in the data model that changes game state.
 *
 * This has no Unity counterpart yet: it is Phase 5 of the Game Loop Technical Spec, which is
 * unbuilt there. It is written to be ported *into* C#, so it dispatches on `EffectData.type` from
 * the vocabulary rather than on the effect id, and it recognises every effect type in that
 * vocabulary even where v1 does nothing with one.
 *
 * A Mission has no reward field. Money, EXP, injuries and losses all arrive through here.
 */

export interface IncidentTarget {
    /** The player's pool. Rewards land here, costs come out of it. */
    inventory: Inventory;
    /** Agents who went. Health effects apply to all of them. */
    agents: RuntimeAgent[];
    /** What each agent carried, so an itemLoss has something to destroy. */
    carried: Map<string, Inventory>;
}

export type IncidentEntry =
    | { kind: 'exp'; amount: number }
    | { kind: 'upgradePoint'; amount: number }
    | { kind: 'itemGained'; itemId: string; qty: number }
    | { kind: 'itemLost'; itemId: string; qty: number }
    | { kind: 'itemCost'; itemId: string; qty: number }
    | { kind: 'health'; characterId: string; delta: number }
    | { kind: 'death'; characterId: string }
    | { kind: 'unsupported'; effectType: string };

export interface IncidentReport {
    incidentId: string;
    /** Silent Incidents still happen; they just do not surface to the player. */
    isSilent: boolean;
    displayName?: string;
    description?: string;
    entries: IncidentEntry[];
}

/** Runs a list of Incident ids in order. Order is authored and load-bearing. */
export function runIncidents(
    incidentIds: readonly string[] | undefined,
    tables: GameTables,
    target: IncidentTarget,
    rng: Rng,
): IncidentReport[] {
    return tables.Incident.getMany(incidentIds).map((incident) =>
        runIncident(incident, tables, target, rng),
    );
}

export function runIncident(
    incident: IncidentData,
    tables: GameTables,
    target: IncidentTarget,
    rng: Rng,
): IncidentReport {
    const entries: IncidentEntry[] = [];

    if (incident.rewardExp) {
        entries.push({ kind: 'exp', amount: incident.rewardExp });
        // Agents and the player earn the same EXP. Runs through addExp so a big enough reward can
        // carry an agent through more than one level-up in a single Incident.
        for (const agent of target.agents) runtimeAgent.addExp(agent, incident.rewardExp);
    }

    if (incident.rewardUpgradePoint) {
        entries.push({ kind: 'upgradePoint', amount: incident.rewardUpgradePoint });
    }

    // Costs before rewards: an Incident that charges for something should not be payable out of what
    // it is about to hand over.
    for (const cost of incident.costItems ?? []) {
        if (!cost.itemId || !cost.qty) continue;
        const removed = Math.min(cost.qty, target.inventory.get(cost.itemId));
        if (removed > 0) {
            target.inventory.remove(cost.itemId, removed);
            entries.push({ kind: 'itemCost', itemId: cost.itemId, qty: removed });
        }
    }

    for (const reward of incident.rewardItems ?? []) {
        if (!reward.itemId || !reward.qty) continue;
        target.inventory.add(reward.itemId, reward.qty);
        entries.push({ kind: 'itemGained', itemId: reward.itemId, qty: reward.qty });
    }

    for (const effect of incident.effects ?? []) {
        entries.push(...applyEffect(effect, tables, target, rng));
    }

    return {
        incidentId: incident.incidentId ?? '',
        isSilent: incident.isSilent ?? false,
        displayName: incident.displayName,
        description: incident.description,
        entries,
    };
}

function applyEffect(
    effect: AppliedEffect,
    tables: GameTables,
    target: IncidentTarget,
    rng: Rng,
): IncidentEntry[] {
    if (!effect.effectId) return [];

    const definition = tables.Effect.get(effect.effectId);
    const type = definition?.type;
    const magnitude = Number(effect.effectValue);
    const amount = Number.isFinite(magnitude) ? magnitude : 0;

    switch (type) {
        // Injury and sickness are damage with different flavour; both take a positive magnitude.
        case 'injury':
        case 'sickness':
            return damageEveryone(target, -Math.abs(amount));

        case 'recovery':
            return damageEveryone(target, Math.abs(amount));

        // The only signed one: the author decides the direction.
        case 'healthChange':
            return damageEveryone(target, amount);

        case 'itemLoss':
            return loseCarriedItems(target, Math.max(1, Math.round(Math.abs(amount) || 1)), rng);

        case 'itemGain':
            // The item id rides in effectValue here, since ItemAmount columns are the usual route.
            if (effect.effectValue) {
                target.inventory.add(effect.effectValue, 1);
                return [{ kind: 'itemGained', itemId: effect.effectValue, qty: 1 }];
            }
            return [];

        case 'death': {
            // Rare by design, and it takes one agent rather than the team.
            const alive = target.agents.filter(runtimeAgent.isAlive);
            if (!alive.length) return [];
            const victim = alive[rng.next(alive.length)];
            victim.currentHealth = 0;
            victim.state = 'dead';
            return [{ kind: 'death', characterId: victim.characterId }];
        }

        // Recognised, and deliberately inert in v1. Buffs, Stat growth, Events and Conversations are
        // all later phases; failing loudly here would make otherwise valid data unplayable.
        case 'debuff':
        case 'statModifier':
        case 'triggerEvent':
        case 'triggerConversation':
            return [{ kind: 'unsupported', effectType: type }];

        default:
            console.warn(
                `[IncidentExecutor] Effect "${effect.effectId}" has unknown type "${type ?? '(none)'}".`,
            );
            return [{ kind: 'unsupported', effectType: type ?? 'unknown' }];
    }
}

function damageEveryone(target: IncidentTarget, delta: number): IncidentEntry[] {
    const entries: IncidentEntry[] = [];

    for (const agent of target.agents) {
        const before = agent.currentHealth;
        runtimeAgent.applyHealthChange(agent, delta);
        const actual = agent.currentHealth - before;
        if (actual !== 0) {
            entries.push({ kind: 'health', characterId: agent.characterId, delta: actual });
        }
        if (agent.state === 'dead') entries.push({ kind: 'death', characterId: agent.characterId });
    }

    return entries;
}

/**
 * Destroys carried items rather than inventory ones.
 *
 * What was taken into the field is what can be lost in it. Items that survive are returned to the
 * pool by the caller after the mission.
 */
function loseCarriedItems(target: IncidentTarget, count: number, rng: Rng): IncidentEntry[] {
    const pool: { characterId: string; itemId: string }[] = [];
    for (const [characterId, inventory] of target.carried) {
        for (const [itemId, qty] of inventory.entries) {
            for (let i = 0; i < qty; i++) pool.push({ characterId, itemId });
        }
    }

    const entries: IncidentEntry[] = [];
    for (let i = 0; i < count && pool.length; i++) {
        const [taken] = pool.splice(rng.next(pool.length), 1);
        target.carried.get(taken.characterId)?.remove(taken.itemId, 1);
        entries.push({ kind: 'itemLost', itemId: taken.itemId, qty: 1 });
    }

    return entries;
}
