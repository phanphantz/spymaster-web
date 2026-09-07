import { Inventory } from './container';
import { runIncidents, type IncidentReport, type IncidentTarget } from './incidents';
import type { LoadoutSession } from './loadout';
import type { LiveMission } from './missionFeed';
import * as resolver from './missionOutcomeResolver';
import type { Rng } from './rng';
import type { RuntimeAgent } from './runtimeAgent';
import type { GameTables, OutcomeData } from './types';

/**
 * Deploying a Mission, and what comes back.
 *
 * This is Phase 7 of the Game Loop Technical Spec collapsed to its v1 shape: with no Tasks, a
 * Mission is a single story point that resolves the moment it is deployed. The Mission's own
 * ordered Outcome list is walked exactly as a Task's would be, so the tiering, the graduated
 * failure and the `luckRoll` all behave as specified — there is simply no chain of Next Tasks to
 * walk afterwards.
 *
 * When Tasks arrive, this becomes the loop around them rather than being replaced.
 */

export interface DeploymentResult {
    mission: LiveMission;
    /** The tier that fired. Undefined only when a Mission has no authored Outcomes at all. */
    outcome?: OutcomeData;
    /** Best, acceptable, bad or criticalFailure. */
    outcomeType?: string;
    /** True for anything above the guaranteed fallback. */
    isSuccess: boolean;
    /** Mission-level Incidents, then the matched Outcome's, in the order they ran. */
    reports: IncidentReport[];
    agents: RuntimeAgent[];
    /** Items that went out and did not come back. */
    itemsLost: { itemId: string; qty: number }[];
    expEarned: number;
    moneyEarned: number;
    moneySpent: number;
}

export interface DeployOptions {
    session: LoadoutSession;
    tables: GameTables;
    inventory: Inventory;
    rng: Rng;
}

/**
 * Runs a confirmed Loadout to its conclusion.
 *
 * Returns undefined when the Loadout cannot be confirmed — a mandatory slot is still empty — or when
 * the Mission's own start Gate refuses it.
 */
export function deploy({ session, tables, inventory, rng }: DeployOptions): DeploymentResult | undefined {
    const context = session.confirm(rng);
    if (!context) return undefined;

    // The start Gate is checked once and has no bearing on the result. In practice it is almost
    // always satisfied by the slots being filled, since that is the same Gate that named them.
    if (!resolver.canStart(session.mission.data, context)) return undefined;

    const agents = session.slots
        .map((slot) => session.agentIn(slot.slotId))
        .filter((agent): agent is RuntimeAgent => agent !== undefined);

    const carried = new Map<string, Inventory>();
    for (const agent of agents) carried.set(agent.characterId, session.carriedBy(agent.characterId));

    const carriedBefore = snapshot(carried);

    const target: IncidentTarget = { inventory, agents, carried };

    for (const agent of agents) {
        agent.state = 'inMission';
        agent.missionAssignedCount++;
    }

    // Mission-level Incidents fire once, at the start, before anything resolves.
    const reports = runIncidents(session.mission.data.incidents, tables, target, rng);

    const outcome = resolver.resolve(session.mission.data, context);
    if (outcome) reports.push(...runIncidents(outcome.incidents, tables, target, rng));

    // What is missing now, compared with what went out, is what the Mission destroyed. This has to
    // be measured before the survivors are handed back, or everything reads as lost.
    const itemsLost = diff(carriedBefore, snapshot(carried));

    // Items return to the pool unless an Incident destroyed them.
    for (const inventoryOfAgent of carried.values()) inventoryOfAgent.transferAllTo(inventory);

    // v1 has no rest: agents are available again immediately.
    for (const agent of agents) {
        if (agent.state === 'inMission') agent.state = 'idle';
    }

    return {
        mission: session.mission,
        outcome,
        outcomeType: outcome?.type,
        isSuccess: Boolean(outcome) && outcome!.type !== 'criticalFailure',
        reports,
        agents,
        itemsLost,
        ...totals(reports),
    };
}

function snapshot(carried: ReadonlyMap<string, Inventory>): Map<string, number> {
    const totalsById = new Map<string, number>();
    for (const inventory of carried.values()) {
        for (const [itemId, qty] of inventory.entries) {
            totalsById.set(itemId, (totalsById.get(itemId) ?? 0) + qty);
        }
    }
    return totalsById;
}

function diff(
    before: ReadonlyMap<string, number>,
    after: ReadonlyMap<string, number>,
): { itemId: string; qty: number }[] {
    const lost: { itemId: string; qty: number }[] = [];
    for (const [itemId, qty] of before) {
        const missing = qty - (after.get(itemId) ?? 0);
        if (missing > 0) lost.push({ itemId, qty: missing });
    }
    return lost;
}

function totals(reports: readonly IncidentReport[]): {
    expEarned: number;
    moneyEarned: number;
    moneySpent: number;
} {
    let expEarned = 0;
    let moneyEarned = 0;
    let moneySpent = 0;

    for (const report of reports) {
        for (const entry of report.entries) {
            if (entry.kind === 'exp') expEarned += entry.amount;
            else if (entry.kind === 'itemGained' && entry.itemId === 'dollar') moneyEarned += entry.qty;
            else if (entry.kind === 'itemCost' && entry.itemId === 'dollar') moneySpent += entry.qty;
        }
    }

    return { expEarned, moneyEarned, moneySpent };
}
