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

    /** Earned, not authored. `level` starts at 1; `exp` is progress toward the next level (it
     *  resets on level-up, see `addExp`), not a lifetime total. */
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

/** A flat placeholder curve — there is no authored progression table yet (see `RuntimeAgent.level`'s
 *  own doc), so this is the one constant to tune until a real one lands. `exp` resets to 0 on every
 *  level-up rather than accumulating for life, so it always reads as "progress toward the next
 *  level," not a lifetime total. */
const EXP_PER_LEVEL = 500;

export function expForNextLevel(agent: RuntimeAgent): number {
    return agent.level * EXP_PER_LEVEL;
}

/** Adds exp and resolves every level-up it crosses (more than one, if the amount is large).
 *  Mutates in place, same as `applyHealthChange`. Returns how many levels were gained. */
export function addExp(agent: RuntimeAgent, amount: number): number {
    agent.exp += amount;
    let gained = 0;
    while (agent.exp >= expForNextLevel(agent)) {
        agent.exp -= expForNextLevel(agent);
        agent.level += 1;
        gained += 1;
    }
    return gained;
}

/** Same resolution as `addExp`, without mutating — for previewing a not-yet-earned amount (e.g. a
 *  mission's reward) against an agent's current progress. `filledTo` is the fill position to draw
 *  against the CURRENT level's own bar: if the amount would level the agent up, that reads as the
 *  bar filling all the way rather than wrapping into a next-level bar of a different length. */
export function previewExpGain(
    agent: RuntimeAgent,
    amount: number,
): { max: number; filledTo: number; levelsGained: number } {
    const max = expForNextLevel(agent);
    let level = agent.level;
    let remaining = agent.exp + amount;
    let levelsGained = 0;
    while (remaining >= level * EXP_PER_LEVEL) {
        remaining -= level * EXP_PER_LEVEL;
        level += 1;
        levelsGained += 1;
    }
    return { max, filledTo: levelsGained > 0 ? max : remaining, levelsGained };
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
