import { create } from 'zustand';
import { loadTables, type LoadedData } from '../data/load';
import { Clock, SPEED_STEPS } from '../engine/clock';
import { Inventory } from '../engine/container';
import { rollOffer, type EmploymentOffer } from '../engine/employment';
import { LoadoutSession } from '../engine/loadout';
import { MissionFeedRuntime, type LiveMission } from '../engine/missionFeed';
import { deploy, type DeploymentResult } from '../engine/missionRun';
import { createRng, randomSeed, type Rng } from '../engine/rng';
import * as runtimeAgent from '../engine/runtimeAgent';
import type { RuntimeAgent } from '../engine/runtimeAgent';
import { describeReason } from '../engine/slotRequirementEvaluator';
import { DOLLAR, type GameTables } from '../engine/types';

/**
 * The whole game state.
 *
 * The engine deals in mutable objects — an Inventory is a live container, a LoadoutSession is a
 * working page — because that is what ports back to C#. React needs a change signal rather than
 * structural equality, so every mutation bumps `version` and components subscribe to that. Deep
 * cloning the engine on every keystroke would be the alternative, and it would cost more than it
 * buys.
 */

export type Phase = 'loading' | 'failed' | 'employment' | 'playing';
export type Overlay = 'none' | 'missionSummary' | 'result' | 'shop';
export type MissionTab = 'details' | 'assignment';

interface GameState {
    phase: Phase;
    error?: string;
    overlay: Overlay;

    data?: LoadedData;
    tables?: GameTables;
    seed: number;
    rng: Rng;
    clock: Clock;
    feed?: MissionFeedRuntime;

    /** Bumped on every engine mutation, so components re-render. */
    version: number;

    roster: RuntimeAgent[];
    inventory: Inventory;
    playerLevel: number;

    offer?: EmploymentOffer;
    picked: string[];

    /** Missions on the World Map, unanswered. */
    pending: LiveMission[];
    selectedInstanceId?: string;

    session?: LoadoutSession;
    result?: DeploymentResult;

    /** Which roster agent is "in hand" for assignment, and which empty slot is "the target" — either
     *  can be set first: pick an agent then tap a slot, or tap a slot then pick an agent. Whichever
     *  is picked second completes the placement. Lives here, not in the modal, so the same
     *  bottom-pinned roster card list stays clickable while the modal sits on top of it. */
    pickingAgentId?: string;
    pickingSlotId?: string;
    /** Why the last slot placement failed, shown under the Assignment tab. */
    assignmentFailure: string;
    /** A drag or click that would trade two occupied slots — held here until the player says
     *  whether the agents trade slots, their kits trade slots, or both. */
    pendingSwap?: { slotA: string; slotB: string };

    /** Which tab the mission modal was on — lifted out of the modal so it survives a detour to the
     *  Shop page and back (Done always lands where the pencil was tapped from). */
    missionTab: MissionTab;
    /** The agent the full-page Shop is equipping. Set by the pencil on a filled slot. */
    shopCharacterId?: string;

    /** Dev panel visibility, off by default. */
    showDataPanel: boolean;

    init: () => Promise<void>;
    restart: (seed?: number) => Promise<void>;

    togglePicked: (characterId: string) => void;
    confirmEmployment: () => void;

    tick: (realDeltaSeconds: number) => void;
    setSpeedIndex: (index: number) => void;
    speedIndex: () => number;
    skipAhead: (minutes: number) => void;

    /** Opens a mission's summary and stands up its Loadout session in the same step — assignment
     *  happens right there, there is no separate page to hand off to. */
    openMission: (instanceId: string) => void;
    closeOverlay: () => void;
    declineMission: (instanceId: string) => void;
    setMissionTab: (tab: MissionTab) => void;

    /** Opens the full-page Shop focused on one agent — from the pencil on their filled slot. */
    openShop: (characterId: string) => void;
    /** Done: back to the mission modal, same tab the pencil was tapped from. */
    closeShop: () => void;

    /** Toggle-selects an agent; if a slot is already picked, completes the placement instead. */
    pickAgent: (characterId: string) => void;
    /** Toggle-selects a slot (empty or occupied); if an agent is already picked, completes the
     *  placement instead. */
    pickSlot: (slotId: string) => void;
    /** The drag-and-drop entry point: both halves arrive at once, so this skips the toggle-select
     *  dance pickAgent/pickSlot do. Pass `fromSlotId` when the drag started on another slot's own
     *  agent card (rather than the roster) — dropped onto a slot occupied by someone else, that
     *  opens the swap dialog instead of bumping either one out. */
    placeAgent: (slotId: string, characterId: string, fromSlotId?: string) => void;
    /** Resolves a pendingSwap: trade the two slots' agents, their kits, or both. */
    resolveSwap: (mode: 'agents' | 'items' | 'both') => void;
    cancelSwap: () => void;
    setAssignmentFailure: (message: string) => void;

    unassignAgent: (slotId: string) => void;
    /** Returns everything one agent carries to stock, in one go — the slot itself has no room to
     *  list items one at a time. */
    discardCarriedItems: (characterId: string) => void;
    purchaseItem: (itemId: string, qty?: number) => void;
    assignItem: (characterId: string, itemId: string, qty?: number) => void;
    unassignItem: (characterId: string, itemId: string, qty?: number) => void;
    deployMission: () => void;

    money: () => number;
    toggleDataPanel: () => void;
}

function startingMoney(tables: GameTables): number {
    const configured = Number(tables.GlobalConfig.get('startingDollar')?.value);
    return Number.isFinite(configured) && configured > 0 ? configured : 10000;
}

function configuredTimeScale(tables: GameTables): number {
    const configured = Number(tables.GlobalConfig.get('timeScale')?.value);
    // 60 means one real second is one in-game minute, which puts a 30-90 minute feed interval at
    // 30-90 real seconds — long enough to feel like waiting, short enough to iterate on.
    return Number.isFinite(configured) && configured > 0 ? configured : 60;
}

export const useGame = create<GameState>((set, get) => {
    /** The one path an agent actually lands in a slot, whichever was picked first — or both at once,
     *  from a drop. Eligibility is re-checked here rather than trusted from the picker, since the
     *  Loadout session is the source of truth for who can go where. Bumping an occupant carries
     *  their items over to whoever replaces them, automatically, up to the new agent's capacity —
     *  whatever doesn't fit goes back to stock rather than being lost. */
    function placeAgentInSlot(slotId: string, characterId: string): void {
        const { session } = get();
        if (!session) return;

        const candidate = session.candidatesFor(slotId).find((entry) => entry.agent.characterId === characterId);
        if (!candidate) return;

        if (!candidate.isEligible) {
            set({
                assignmentFailure: candidate.reasons.length
                    ? describeReason(candidate.reasons[0])
                    : `${runtimeAgent.displayName(candidate.agent)} cannot take this slot`,
            });
            return;
        }

        const occupant = session.agentIn(slotId);
        const carriedBefore =
            occupant && occupant.characterId !== characterId ? [...session.carriedBy(occupant.characterId).entries] : [];

        session.assignAgent(slotId, characterId);

        for (const [itemId, qty] of carriedBefore) {
            const room = session.remainingCapacity(characterId);
            if (room <= 0) break;
            session.assignItem(characterId, itemId, Math.min(qty, room));
        }

        set({
            pickingAgentId: undefined,
            pickingSlotId: undefined,
            assignmentFailure: '',
            version: get().version + 1,
        });
    }

    /** Both slots must be occupied by two different agents to trade at all, and — for the two modes
     *  that move an agent into the other slot — each must qualify for the slot they'd land in.
     *  Returns the pair, or undefined (with assignmentFailure already set) if the trade is blocked. */
    function agentsForSwap(
        slotIdA: string,
        slotIdB: string,
        checkEligibility: boolean,
    ): [RuntimeAgent, RuntimeAgent] | undefined {
        const { session } = get();
        if (!session || slotIdA === slotIdB) return undefined;

        const agentA = session.agentIn(slotIdA);
        const agentB = session.agentIn(slotIdB);
        if (!agentA || !agentB || agentA.characterId === agentB.characterId) return undefined;

        if (checkEligibility) {
            const aFitsB = session.candidatesFor(slotIdB).find((entry) => entry.agent.characterId === agentA.characterId);
            const bFitsA = session.candidatesFor(slotIdA).find((entry) => entry.agent.characterId === agentB.characterId);
            if (!aFitsB?.isEligible || !bFitsA?.isEligible) {
                const blocked = !aFitsB?.isEligible ? agentA : agentB;
                set({ assignmentFailure: `${runtimeAgent.displayName(blocked)} cannot take that slot` });
                return undefined;
            }
        }

        return [agentA, agentB];
    }

    /** Trades the two slots' agents; each keeps their own kit, which travels with them. Never
     *  touches capacity, since both were already carrying what they carry. */
    function swapBoth(slotIdA: string, slotIdB: string): void {
        const { session } = get();
        const pair = agentsForSwap(slotIdA, slotIdB, true);
        if (!session || !pair) return;
        const [agentA, agentB] = pair;

        const itemsA = [...session.carriedBy(agentA.characterId).entries];
        const itemsB = [...session.carriedBy(agentB.characterId).entries];

        // Vacate both first so neither assignAgent call's own displacement logic fires on the other
        // — it would otherwise dump the displaced agent's items to stock rather than move them.
        session.unassignAgent(slotIdA);
        session.unassignAgent(slotIdB);
        session.assignAgent(slotIdB, agentA.characterId);
        session.assignAgent(slotIdA, agentB.characterId);

        for (const [itemId, qty] of itemsA) session.assignItem(agentA.characterId, itemId, qty);
        for (const [itemId, qty] of itemsB) session.assignItem(agentB.characterId, itemId, qty);

        set({ pickingAgentId: undefined, pickingSlotId: undefined, assignmentFailure: '', version: get().version + 1 });
    }

    /** Trades the two slots' agents, but their kits stay put — each agent arrives wearing whoever
     *  was there before's kit (capped to their own capacity; anything that doesn't fit goes to
     *  stock rather than being lost). */
    function swapAgentsOnly(slotIdA: string, slotIdB: string): void {
        const { session } = get();
        const pair = agentsForSwap(slotIdA, slotIdB, true);
        if (!session || !pair) return;
        const [agentA, agentB] = pair;

        const itemsA = [...session.carriedBy(agentA.characterId).entries];
        const itemsB = [...session.carriedBy(agentB.characterId).entries];

        session.unassignAgent(slotIdA);
        session.unassignAgent(slotIdB);
        session.assignAgent(slotIdB, agentA.characterId);
        session.assignAgent(slotIdA, agentB.characterId);

        // itemsA belonged to slotA, which agentB now occupies — and vice versa.
        for (const [itemId, qty] of itemsA) {
            const room = session.remainingCapacity(agentB.characterId);
            if (room <= 0) break;
            session.assignItem(agentB.characterId, itemId, Math.min(qty, room));
        }
        for (const [itemId, qty] of itemsB) {
            const room = session.remainingCapacity(agentA.characterId);
            if (room <= 0) break;
            session.assignItem(agentA.characterId, itemId, Math.min(qty, room));
        }

        set({ pickingAgentId: undefined, pickingSlotId: undefined, assignmentFailure: '', version: get().version + 1 });
    }

    /** Trades the two slots' kits; both agents stay right where they are. No eligibility check —
     *  a slot's requirement is about the agent standing in it, not what they're carrying. Capped to
     *  each agent's own capacity, same as swapAgentsOnly. */
    function swapItemsOnly(slotIdA: string, slotIdB: string): void {
        const { session } = get();
        const pair = agentsForSwap(slotIdA, slotIdB, false);
        if (!session || !pair) return;
        const [agentA, agentB] = pair;

        const itemsA = [...session.carriedBy(agentA.characterId).entries];
        const itemsB = [...session.carriedBy(agentB.characterId).entries];

        for (const [itemId, qty] of itemsA) session.unassignItem(agentA.characterId, itemId, qty);
        for (const [itemId, qty] of itemsB) session.unassignItem(agentB.characterId, itemId, qty);

        for (const [itemId, qty] of itemsA) {
            const room = session.remainingCapacity(agentB.characterId);
            if (room <= 0) break;
            session.assignItem(agentB.characterId, itemId, Math.min(qty, room));
        }
        for (const [itemId, qty] of itemsB) {
            const room = session.remainingCapacity(agentA.characterId);
            if (room <= 0) break;
            session.assignItem(agentA.characterId, itemId, Math.min(qty, room));
        }

        set({ pickingAgentId: undefined, pickingSlotId: undefined, assignmentFailure: '', version: get().version + 1 });
    }

    return {
    phase: 'loading',
    overlay: 'none',
    seed: 0,
    rng: createRng(1),
    clock: new Clock(),
    version: 0,
    roster: [],
    inventory: new Inventory(),
    playerLevel: 1,
    picked: [],
    pending: [],
    assignmentFailure: '',
    missionTab: 'details',
    showDataPanel: false,

    async init() {
        await get().restart();
    },

    async restart(seedValue?: number) {
        set({ phase: 'loading', error: undefined, overlay: 'none' });

        let data: LoadedData;
        try {
            data = await loadTables();
        } catch (cause) {
            set({ phase: 'failed', error: `Could not load game data: ${String(cause)}` });
            return;
        }

        const { tables } = data;
        const seed = seedValue ?? randomSeed();
        const rng = createRng(seed);

        // Missions arrive on the clock, so the feed has to run even though nothing else does.
        const clock = new Clock({ timeScale: configuredTimeScale(tables) });
        const feed = new MissionFeedRuntime(tables, rng);
        feed.syncActiveFeed(1, 0);

        const offer = rollOffer(tables, 1, rng);

        set({
            phase: offer ? 'employment' : 'playing',
            data,
            tables,
            seed,
            rng,
            clock,
            feed,
            offer,
            picked: [],
            roster: [],
            pending: [],
            inventory: new Inventory([[DOLLAR, startingMoney(tables)]]),
            playerLevel: 1,
            session: undefined,
            result: undefined,
            selectedInstanceId: undefined,
            pickingAgentId: undefined,
            pickingSlotId: undefined,
            assignmentFailure: '',
            missionTab: 'details',
            shopCharacterId: undefined,
            pendingSwap: undefined,
            version: get().version + 1,
        });

        if (!offer) {
            console.warn('[gameStore] No Employment row for this level; starting with no roster.');
        }
    },

    togglePicked(characterId) {
        const { picked, offer } = get();
        if (!offer) return;

        if (picked.includes(characterId)) {
            set({ picked: picked.filter((id) => id !== characterId) });
        } else if (picked.length < offer.pickQty) {
            set({ picked: [...picked, characterId] });
        }
    },

    confirmEmployment() {
        const { offer, picked } = get();
        if (!offer || picked.length !== offer.pickQty) return;

        const roster = offer.candidates.filter((agent) => picked.includes(agent.characterId));
        set({ roster, phase: 'playing', version: get().version + 1 });
    },

    tick(realDeltaSeconds) {
        const { clock, feed, phase } = get();
        if (phase !== 'playing' || !feed) return;

        const before = clock.totalMinutes;
        clock.tick(realDeltaSeconds);
        if (clock.totalMinutes === before) return;

        // Ask the feed about every minute that passed, not just the last one, so a fast speed
        // setting cannot skip a release.
        const pending = [...get().pending];
        for (let minute = before + 1; minute <= clock.totalMinutes; minute++) {
            const mission = feed.evaluate(minute, pending.length);
            if (mission) pending.push(mission);
        }

        set({ pending, version: get().version + 1 });
    },

    setSpeedIndex(index) {
        const { clock } = get();
        const step = SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, index))];
        clock.speedMultiplier = step;
        clock.isPaused = step === 0;
        set({ version: get().version + 1 });
    },

    speedIndex() {
        const { clock } = get();
        if (clock.isPaused || clock.speedMultiplier === 0) return 0;
        const found = SPEED_STEPS.indexOf(clock.speedMultiplier as (typeof SPEED_STEPS)[number]);
        return found === -1 ? 1 : found;
    },

    skipAhead(minutes) {
        const { clock, feed, phase } = get();
        if (phase !== 'playing' || !feed) return;

        const before = clock.totalMinutes;
        clock.addMinutes(minutes);

        const pending = [...get().pending];
        for (let minute = before + 1; minute <= clock.totalMinutes; minute++) {
            const mission = feed.evaluate(minute, pending.length);
            if (mission) pending.push(mission);
        }

        set({ pending, version: get().version + 1 });
    },

    openMission(instanceId) {
        const { tables, roster, inventory, playerLevel, pending } = get();
        const mission = pending.find((candidate) => candidate.instanceId === instanceId);
        if (!tables || !mission) return;

        set({
            selectedInstanceId: instanceId,
            session: new LoadoutSession(mission, tables, roster, inventory, playerLevel),
            overlay: 'missionSummary',
            pickingAgentId: undefined,
            pickingSlotId: undefined,
            assignmentFailure: '',
            missionTab: 'details',
            shopCharacterId: undefined,
            pendingSwap: undefined,
            version: get().version + 1,
        });
    },

    closeOverlay() {
        // Returns every carried item, so backing out of a mission costs nothing.
        get().session?.cancel();
        set({
            overlay: 'none',
            selectedInstanceId: undefined,
            session: undefined,
            pickingAgentId: undefined,
            pickingSlotId: undefined,
            assignmentFailure: '',
            shopCharacterId: undefined,
            pendingSwap: undefined,
            version: get().version + 1,
        });
    },

    declineMission(instanceId) {
        const mission = get().pending.find((candidate) => candidate.instanceId === instanceId);
        // Declining is free, but a Mission authors whether it may be declined at all.
        if (mission && mission.data.isDeclinable === false) return;

        get().session?.cancel();
        set({
            pending: get().pending.filter((candidate) => candidate.instanceId !== instanceId),
            overlay: 'none',
            selectedInstanceId: undefined,
            session: undefined,
            pickingAgentId: undefined,
            pickingSlotId: undefined,
            assignmentFailure: '',
            shopCharacterId: undefined,
            pendingSwap: undefined,
            version: get().version + 1,
        });
    },

    setMissionTab(tab) {
        set({ missionTab: tab });
    },

    openShop(characterId) {
        set({ overlay: 'shop', shopCharacterId: characterId });
    },

    closeShop() {
        set({ overlay: 'missionSummary', shopCharacterId: undefined });
    },

    pickAgent(characterId) {
        const { pickingSlotId, session } = get();
        if (pickingSlotId && session) {
            placeAgentInSlot(pickingSlotId, characterId);
            return;
        }
        set((state) => ({
            pickingAgentId: state.pickingAgentId === characterId ? undefined : characterId,
            assignmentFailure: '',
        }));
    },

    pickSlot(slotId) {
        const { pickingAgentId, session } = get();
        if (pickingAgentId && session) {
            placeAgentInSlot(slotId, pickingAgentId);
            return;
        }
        set((state) => ({
            pickingSlotId: state.pickingSlotId === slotId ? undefined : slotId,
            assignmentFailure: '',
        }));
    },

    placeAgent(slotId, characterId, fromSlotId) {
        const { session } = get();
        if (session && fromSlotId && fromSlotId !== slotId) {
            const targetOccupant = session.agentIn(slotId);
            if (targetOccupant && targetOccupant.characterId !== characterId) {
                set({
                    pickingAgentId: undefined,
                    pickingSlotId: undefined,
                    assignmentFailure: '',
                    pendingSwap: { slotA: fromSlotId, slotB: slotId },
                });
                return;
            }
        }
        placeAgentInSlot(slotId, characterId);
    },

    resolveSwap(mode) {
        const { pendingSwap } = get();
        if (!pendingSwap) return;
        const { slotA, slotB } = pendingSwap;
        set({ pendingSwap: undefined });
        if (mode === 'agents') swapAgentsOnly(slotA, slotB);
        else if (mode === 'items') swapItemsOnly(slotA, slotB);
        else swapBoth(slotA, slotB);
    },

    cancelSwap() {
        set({ pendingSwap: undefined });
    },

    setAssignmentFailure(message) {
        set({ assignmentFailure: message });
    },

    unassignAgent(slotId) {
        get().session?.unassignAgent(slotId);
        set({ version: get().version + 1 });
    },

    discardCarriedItems(characterId) {
        const { session } = get();
        if (!session) return;
        for (const [itemId, qty] of [...session.carriedBy(characterId).entries]) {
            session.unassignItem(characterId, itemId, qty);
        }
        set({ version: get().version + 1 });
    },

    purchaseItem(itemId, qty = 1) {
        get().session?.shop.purchase(itemId, qty);
        set({ version: get().version + 1 });
    },

    assignItem(characterId, itemId, qty = 1) {
        get().session?.assignItem(characterId, itemId, qty);
        set({ version: get().version + 1 });
    },

    unassignItem(characterId, itemId, qty = 1) {
        get().session?.unassignItem(characterId, itemId, qty);
        set({ version: get().version + 1 });
    },

    deployMission() {
        const { session, tables, inventory, rng, pending } = get();
        if (!session || !tables) return;

        const result = deploy({ session, tables, inventory, rng });
        if (!result) return;

        set({
            result,
            overlay: 'result',
            session: undefined,
            selectedInstanceId: undefined,
            pickingAgentId: undefined,
            pickingSlotId: undefined,
            shopCharacterId: undefined,
            pendingSwap: undefined,
            pending: pending.filter((candidate) => candidate.instanceId !== session.mission.instanceId),
            version: get().version + 1,
        });
    },

    money() {
        return get().inventory.get(DOLLAR);
    },

    toggleDataPanel() {
        set({ showDataPanel: !get().showDataPanel });
    },
    };
});
