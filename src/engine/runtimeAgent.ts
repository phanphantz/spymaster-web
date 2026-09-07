import { StatContainer } from './container';
import type { AgentSlotAssignment } from './gateContext';
import type { AgentData, CharacterData } from './types';

/**
 * An employed agent, as the game sees them.
 *
 * Port of `Assets/Scripts/Spymaster/Characters/RuntimeAgent.cs`. Unity splits an agent across three
 * saved rows — authored `AgentData`, earned `AgentProgress`, and live `PlayerAgent` — and joins them
 * into a view. v1 has no progression and no save, so the earned half is a small mutable block held
 * here instead; the derived values below are the same ones, and stay the same when progression
 * lands.
 */

export type AgentState = 'idle' | 'inMission' | 'resting' | 'dead';

export interface RuntimeAgent {
    characterId: string;
    data: AgentData;
    character?: CharacterData;

    state: AgentState;
    currentHealth: number;

    /** Earned, not authored. Zero throughout v1 — there is no level-up yet. */
    level: number;
    exp: number;
    addedStats: StatContainer;
    addedSkillIds: string[];
    /** Only an Agent Upgrade raises these. Level-up never does. */
    addedMaxHealth: number;
    addedInventorySize: number;

    missionAssignedCount: number;
}

export function createAgent(data: AgentData, character?: CharacterData): RuntimeAgent {
    const maxHealth = data.baseHealth ?? 0;
    return {
        characterId: data.characterId ?? '',
        data,
        character,
        state: 'idle',
        currentHealth: maxHealth,
        level: 1,
        exp: 0,
        addedStats: new StatContainer(),
        addedSkillIds: [],
        addedMaxHealth: 0,
        addedInventorySize: 0,
        missionAssignedCount: 0,
    };
}

/** Authored base plus points spent on level-up. */
export function effectiveStats(agent: RuntimeAgent): StatContainer {
    const summed = StatContainer.sum([StatContainer.fromColumns(agent.data), agent.addedStats]);
    return new StatContainer(summed.entries);
}

/** Fixed per-agent base plus Agent Upgrades. Level-up never touches it. */
export function maxHealth(agent: RuntimeAgent): number {
    return (agent.data.baseHealth ?? 0) + agent.addedMaxHealth;
}

/** Same rule as max health: authored base plus Agent Upgrades only. */
export function inventorySize(agent: RuntimeAgent): number {
    return (agent.data.baseInventorySize ?? 0) + agent.addedInventorySize;
}

export function skillIds(agent: RuntimeAgent): string[] {
    // Base first, then unlocked, deduped with order preserved.
    return [...new Set([...(agent.data.baseSkillIds ?? []), ...agent.addedSkillIds])];
}

export function tags(agent: RuntimeAgent): string[] {
    return agent.data.tags ?? [];
}

export function isAlive(agent: RuntimeAgent): boolean {
    return agent.state !== 'dead' && agent.currentHealth > 0;
}

export function isAvailable(agent: RuntimeAgent): boolean {
    return agent.state === 'idle' && isAlive(agent);
}

export function displayName(agent: RuntimeAgent): string {
    return agent.character?.codeNames?.[0] ?? agent.characterId;
}

export function fullName(agent: RuntimeAgent): string {
    const { firstName, lastName } = agent.character ?? {};
    return [firstName, lastName].filter(Boolean).join(' ') || agent.characterId;
}

/** Flattens the agent to just what a Gate reads. */
export function toSlotAssignment(agent: RuntimeAgent, slotId: string): AgentSlotAssignment {
    return {
        slotId,
        characterId: agent.characterId,
        level: agent.level,
        stats: effectiveStats(agent),
        skillIds: skillIds(agent),
        tags: tags(agent),
    };
}

/** Clamped both ends: nothing exceeds max health, and nothing goes below zero. */
export function applyHealthChange(agent: RuntimeAgent, delta: number): void {
    agent.currentHealth = Math.max(0, Math.min(maxHealth(agent), agent.currentHealth + delta));
    if (agent.currentHealth === 0) agent.state = 'dead';
}
