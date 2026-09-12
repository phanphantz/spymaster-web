import { useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import type { RuntimeAgent } from '../../engine/runtimeAgent';
import {
    AgentCard,
    ConfirmDialog,
    DifficultyPips,
    Emphasized,
    EquipIcon,
    HoldButton,
    Modal,
    PageTabs,
    StatAbbr,
    StatHexagon,
    parseAgentDragPayload,
} from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { GameTables, StatId } from '../../engine/types';
import type { LoadoutSession } from '../../engine/loadout';
import type { LiveMission } from '../../engine/missionFeed';
import { previewReward, previewLikelihood } from '../../engine/missionPreview';
import { ShopScreen } from './ShopScreen';

/** Per-stat sum across a set of agents — the team's combined hexagon reads this, not any one agent's. */
function combinedStats(agents: readonly RuntimeAgent[]): Map<StatId, number> {
    const totals = new Map<StatId, number>();
    for (const stat of STAT_IDS) {
        totals.set(stat, agents.reduce((sum, agent) => sum + runtimeAgent.effectiveStats(agent).get(stat), 0));
    }
    return totals;
}

const LIKELIHOOD_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/**
 * The planning-status chip pinned in the modal's own top-right corner (`Modal`'s `corner` prop) —
 * one fixture shared by the Mission page and the Kit page, since both are just `children` swapped
 * inside the same Modal instance. Reads live off the session on every render, so dragging an item
 * in Kit mode updates it immediately, with no separate refresh path to keep in sync.
 *
 * Success is Low/Medium/High, not a percentage — `missionOutcomeResolver` computes none, by design
 * (see its own docs) — this just relabels whichever Outcome tier the current Loadout would clear
 * right now. Cost is the total already charged for what is presently assigned, i.e. what cancelling
 * the whole Loadout would refund.
 */
function PlanningStatus({ session }: { session: LoadoutSession }): ReactNode {
    const likelihood = previewLikelihood(session);
    const cost = session.totalPreparationCost();

    return (
        <div className="planning-status">
            <span className="planning-status__item">
                <span className="planning-status__label">Cost</span>
                <span className="planning-status__value planning-status__value--cost">
                    ${cost.toLocaleString('en-US')}
                </span>
            </span>
            <span className="planning-status__item">
                <span className="planning-status__label">Success</span>
                <span className={`planning-status__value planning-status__value--${likelihood ?? 'none'}`}>
                    {likelihood ? LIKELIHOOD_LABEL[likelihood] : '—'}
                </span>
            </span>
        </div>
    );
}

/**
 * The modal's whole top-right fixture: Cost, Success, then Confirm — grouped so deploying is one
 * press-and-hold away from the same status a player is reading to decide whether to. Pinned to the
 * modal frame itself (not `.summary__stats`), it stays reachable from the Kit page too — there's no
 * longer a separate Confirm button that only existed on the Mission page.
 */
function MissionCorner({ session, onDeploy }: { session: LoadoutSession; onDeploy: () => void }): ReactNode {
    return (
        <div className="mission-corner">
            <PlanningStatus session={session} />
            <HoldButton
                className="btn--primary mission-corner__confirm"
                label="Confirm"
                disabled={!session.canConfirm}
                onComplete={onDeploy}
            />
        </div>
    );
}

/**
 * The Mission UI: read the contract, build the team, then deploy or decline — one page, not a
 * tab switcher. Follows `UIMissionSummary` in `UI_DESIGN_SYSTEM.md` §5.3 for the briefing half —
 * photo and location on the left, the briefing and the team in the middle, split by a steel rule
 * carrying a notification dot. The team's combined stats — hexagon and gauges — live in their own
 * rail on the far right, always visible instead of swapped in over the location block, since
 * they're what the player is actually optimizing while they work the slot grid next to them.
 *
 * Assignment happens in the same modal rather than handing off to a separate Loadout page: the
 * Loadout session is stood up the moment the mission opens, and the slot grid is that session's
 * real, interactive state, not a preview of it.
 *
 * It shows the hint, which is authored and may be deliberately oblique, and what the job demands of
 * a team. It does **not** show a success chance, because none is computed — the result is whichever
 * authored Outcome tier the loadout clears.
 */
export function MissionSummary(): ReactNode {
    useGame((state) => state.version);

    const tables = useGame((state) => state.tables);
    const session = useGame((state) => state.session);
    const close = useGame((state) => state.closeOverlay);
    const deploy = useGame((state) => state.deployMission);
    const decline = useGame((state) => state.declineMission);
    const unassignAgent = useGame((state) => state.unassignAgent);
    const pickingAgentId = useGame((state) => state.pickingAgentId);
    const pickingSlotId = useGame((state) => state.pickingSlotId);
    const pickSlot = useGame((state) => state.pickSlot);
    const placeAgent = useGame((state) => state.placeAgent);
    const pendingSwap = useGame((state) => state.pendingSwap);
    const resolveSwap = useGame((state) => state.resolveSwap);
    const cancelSwap = useGame((state) => state.cancelSwap);
    const failure = useGame((state) => state.assignmentFailure);
    const openShop = useGame((state) => state.openShop);
    const overlay = useGame((state) => state.overlay);
    const closeShop = useGame((state) => state.closeShop);

    const [confirmingDecline, setConfirmingDecline] = useState(false);
    const [confirmingClose, setConfirmingClose] = useState(false);

    if (!session || !tables) return null;

    const inventoryMode = overlay === 'shop';
    const mission = session.mission;
    const canDecline = mission.data.isDeclinable !== false;
    const hasAssignments = session.assignments.size > 0;
    const assigned = session.assignedAgents();

    const keywordTerms = [
        mission.location?.displayName,
        mission.data.type,
        ...session.slots.flatMap((slot) => [
            ...(slot.requirement?.tags ?? []),
            ...(slot.requirement?.excludedTags ?? []),
        ]),
    ].filter((term): term is string => Boolean(term));

    return (
        <Modal
            onClose={() => (inventoryMode ? closeShop() : hasAssignments ? setConfirmingClose(true) : close())}
            wide
            kit={inventoryMode}
            label={inventoryMode ? 'Kit' : (mission.data.displayName ?? 'Mission')}
            hideClose
            corner={<MissionCorner session={session} onDeploy={deploy} />}
            topLeft={
                <button
                    type="button"
                    className="btn btn--quiet btn--small"
                    onClick={() => (hasAssignments ? setConfirmingClose(true) : close())}
                >
                    Close
                </button>
            }
        >
            <div className="modal__body">
                {inventoryMode ? (
                    <ShopScreen
                        session={session}
                        tables={tables}
                        onSelectTab={(tab) => (tab === 'agent' ? closeShop() : undefined)}
                    />
                ) : (
                <div className="summary">
                    <div className="summary__left">
                        <div className="summary__photo">NO IMAGE</div>
                        <div className="summary__lower-anchor">
                            <hr className="summary__dashrule" />
                            <LocationBlock mission={mission} />
                        </div>
                    </div>

                    <div className="summary__divider">
                        <span className="summary__dot" aria-hidden="true" />
                    </div>

                    <div className="summary__right">
                        <button
                            type="button"
                            className="icon-btn summary__decline"
                            onClick={() => setConfirmingDecline(true)}
                            disabled={!canDecline}
                            aria-label="Decline mission"
                            title={canDecline ? 'Decline mission' : 'This client does not take no for an answer'}
                        >
                            🗑
                        </button>
                        <div className="summary__scroll">
                            <h2 className="summary__name">{mission.data.displayName}</h2>

                            <div className="summary__row">
                                <span className="chip">{mission.data.type ?? 'contract'}</span>
                                <DifficultyPips level={mission.data.difficultyLevel} />
                            </div>

                            {mission.data.hint ? (
                                <p className="hint">
                                    <Emphasized text={mission.data.hint} terms={keywordTerms} />
                                </p>
                            ) : null}

                            {mission.data.description ? (
                                <p className="summary__body">
                                    <Emphasized text={mission.data.description} terms={keywordTerms} />
                                </p>
                            ) : null}
                        </div>

                        {/* Pinned outside the scroll region, not squeezed by it — a long hint or
                            description scrolls in the space above, but the slot grid (up to 4 slots,
                            2 rows at their fixed height) always has the room it needs and is never
                            what gets clipped or pushed into a scrollbar. */}
                        <MissionTeam
                            session={session}
                            tables={tables}
                            pickingAgentId={pickingAgentId}
                            pickingSlotId={pickingSlotId}
                            onPickSlot={pickSlot}
                            onDropAgent={placeAgent}
                            onUnassign={unassignAgent}
                            onEdit={openShop}
                            failure={failure}
                        />
                    </div>

                    <div className="summary__stats">
                        <RewardSquares mission={mission} tables={tables} />
                        {assigned.length > 0 ? (
                            <div className="summary__photo summary__photo--stats">
                                <StatHexagon totals={combinedStats(assigned)} />
                            </div>
                        ) : (
                            <p className="summary__stats-empty">Assign agents to see stat summary</p>
                        )}
                        <div className="summary__lower-anchor">
                            <hr className="summary__dashrule" />
                            {assigned.length > 0 ? <StatGaugeList agents={assigned} tables={tables} /> : null}
                            <div className="summary__actions summary__actions--right">
                                <PageTabs active="agent" onSelect={(tab) => (tab === 'inventory' ? openShop('') : undefined)} />
                            </div>
                        </div>
                    </div>
                </div>
                )}
            </div>

            <ConfirmDialog
                open={confirmingDecline}
                title="Decline this mission?"
                message="The client won't be asked twice. This contract leaves the board for good."
                confirmLabel="Decline"
                danger
                onConfirm={() => {
                    setConfirmingDecline(false);
                    decline(mission.instanceId);
                }}
                onCancel={() => setConfirmingDecline(false)}
            />

            <ConfirmDialog
                open={confirmingClose}
                title="Close this loadout?"
                message="Every assigned agent will be pulled off this job and anything they're carrying is refunded. Nothing is lost — but you'll have to build the team again."
                confirmLabel="Close"
                danger
                onConfirm={() => {
                    setConfirmingClose(false);
                    close();
                }}
                onCancel={() => setConfirmingClose(false)}
            />

            <SwapDialog
                pendingSwap={pendingSwap}
                session={session}
                onSwapAgents={() => resolveSwap('agents')}
                onSwapItems={() => resolveSwap('items')}
                onSwapBoth={() => resolveSwap('both')}
                onCancel={cancelSwap}
            />
        </Modal>
    );
}

/**
 * Dragging (or clicking) one occupied slot's agent onto another pauses here rather than picking a
 * default — trade just who stands where, just their kits, or both together (each agent leaving with
 * their own kit, as if they'd simply swapped places).
 */
function SwapDialog({
    pendingSwap,
    session,
    onSwapAgents,
    onSwapItems,
    onSwapBoth,
    onCancel,
}: {
    pendingSwap: { slotA: string; slotB: string } | undefined;
    session: LoadoutSession;
    onSwapAgents: () => void;
    onSwapItems: () => void;
    onSwapBoth: () => void;
    onCancel: () => void;
}): ReactNode {
    if (!pendingSwap) return null;

    const agentA = session.agentIn(pendingSwap.slotA);
    const agentB = session.agentIn(pendingSwap.slotB);
    if (!agentA || !agentB) return null;

    return (
        <div className="backdrop" onClick={onCancel} role="presentation">
            <div
                className="confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label="Swap slots"
                onClick={(event) => event.stopPropagation()}
            >
                <button type="button" className="icon-btn confirm__close" onClick={onCancel} aria-label="Cancel">
                    ✕
                </button>
                <h3 className="confirm__title">
                    Swap {runtimeAgent.displayName(agentA)} and {runtimeAgent.displayName(agentB)}?
                </h3>
                <p className="confirm__body">Trade who's in which slot, what they're carrying, or both.</p>
                <div className="confirm__actions confirm__actions--stack">
                    <button type="button" className="btn btn--quiet" onClick={onSwapAgents}>
                        Swap Agents
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={onSwapItems}>
                        Swap Items
                    </button>
                    <button type="button" className="btn btn--primary" onClick={onSwapBoth}>
                        Swap Both
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * The team's combined stats as horizontal gauges — icon + code on the left, a fixed-width bar, the
 * total on the right. Sits under the hexagon in the always-visible right rail: the hexagon above is
 * the shape, this is the same numbers read as a bar per stat.
 */
function StatGaugeList({ agents, tables }: { agents: readonly RuntimeAgent[]; tables: GameTables }): ReactNode {
    return (
        <div className="stat-gauges">
            {STAT_IDS.map((stat) => {
                const total = agents.reduce((sum, agent) => sum + runtimeAgent.effectiveStats(agent).get(stat), 0);
                // Fixed to one agent's max, not the team's — a second agent should visibly push the
                // bar further, not just hold the same ratio the cap grew to match.
                const cap = tables.Stat.get(stat)?.maxValue ?? 20;
                const ratio = cap > 0 ? Math.min(1, total / cap) : 0;

                return (
                    <div className="stat-gauge" key={stat}>
                        <span className="stat-gauge__label">
                            <StatAbbr stat={stat} />
                        </span>
                        <span className="stat-gauge__track">
                            <span className="stat-gauge__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
                        </span>
                        <span className="stat-gauge__value">{total}</span>
                    </div>
                );
            })}
        </div>
    );
}

/** Payment and exp, as a small square item list at the head of the stats rail — above the hexagon,
 *  which centers in whatever room that leaves above the gauges. */
function RewardSquares({ mission, tables }: { mission: LiveMission; tables: GameTables }): ReactNode {
    const reward = previewReward(tables, mission.data.outcomes?.[0]);

    return (
        <div className="reward-box">
            <span className="reward-box__label">Rewards</span>
            <div className="reward-squares">
                <div className="reward-square">
                    <span className="reward-square__icon" aria-hidden="true">💰</span>
                    <span className="reward-square__value">
                        {reward.money ? `$${reward.money.toLocaleString('en-US')}` : '—'}
                    </span>
                </div>
                <div className="reward-square">
                    <span className="reward-square__icon" aria-hidden="true">⭐</span>
                    <span className="reward-square__value">{reward.exp || '—'}</span>
                </div>
            </div>
        </div>
    );
}

/** Location name, address and coordinates, sitting under the photo's fade.
 *  The More/Less disclosure (type, size, state) is hidden for now — hidden, not removed, since the
 *  fields it read are still authored and this is the one place they'd surface. */
function LocationBlock({ mission }: { mission: LiveMission }): ReactNode {
    const location = mission.location;

    return (
        <div className="summary__location">
            <span className="summary__location-name">{location?.displayName ?? 'Unknown'}</span>
            <span className="summary__location-detail">
                {location?.address ?? titleCase(location?.country) ?? 'Location withheld'}
            </span>
            <span className="summary__location-detail">
                {formatCoordinate(location?.latitude, 'N', 'S')}{' '}
                {formatCoordinate(location?.longitude, 'E', 'W')}
            </span>
        </div>
    );
}

/**
 * The team's slot grid — pinned to the floor of the middle column, outside the briefing's scroll
 * area, so a long hint or description never squeezes it. Up to 4 slots (2 rows at their fixed
 * height) always has the room it needs; the briefing scrolls instead.
 *
 * The real, interactive Loadout — pick an agent from the roster strip below the modal, then tap a
 * slot, or tap an empty slot first and pick the agent after; either order lands the same placement.
 * An occupied slot clears with the subtle "−" pinned to its corner — same convention as a carried
 * item's own corner remove — and its role/optional label disappears once filled, handing that room
 * to the card itself. What that agent carries lives on its own page, opened by tapping the kit
 * preview floating above the slot — the slot itself has no room for a kit list.
 */
function MissionTeam({
    session,
    tables,
    pickingAgentId,
    pickingSlotId,
    onPickSlot,
    onDropAgent,
    onUnassign,
    onEdit,
    failure,
}: {
    session: LoadoutSession;
    tables: GameTables;
    pickingAgentId: string | undefined;
    pickingSlotId: string | undefined;
    onPickSlot: (slotId: string) => void;
    onDropAgent: (slotId: string, characterId: string, fromSlotId?: string) => void;
    onUnassign: (slotId: string) => void;
    onEdit: (characterId: string) => void;
    failure: string;
}): ReactNode {
    return (
        <div className="summary__team">
            <div className="slot-grid">
                {session.slots.map((slot) => {
                        const occupant = session.agentIn(slot.slotId);
                        const isTarget = slot.slotId === pickingSlotId;
                        // A picked agent (from a click, not mid-drag) could land here and bump someone —
                        // hinted so the slot doesn't just look like a dead end while something is picked.
                        const isReplaceable = Boolean(
                            occupant && pickingAgentId && occupant.characterId !== pickingAgentId,
                        );
                        const className = [
                            'slot',
                            occupant ? 'slot--filled' : '',
                            !occupant && slot.isMandatory ? 'slot--needed' : '',
                            isTarget ? 'slot--picking' : '',
                            isReplaceable ? 'slot--replaceable' : '',
                        ]
                            .filter(Boolean)
                            .join(' ');

                        const carried = occupant ? session.carriedSlots(occupant.characterId) : [];
                        const capacity = occupant ? runtimeAgent.inventorySize(occupant) : 0;
                        const emptySlots = Math.max(0, capacity - carried.length);

                        return (
                            <div className="slot-wrap" key={slot.slotId}>
                                {occupant && capacity > 0 ? (
                                    <button
                                        type="button"
                                        className="slot__items-float"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onEdit(occupant.characterId);
                                        }}
                                        aria-label={`Edit ${runtimeAgent.displayName(occupant)}'s kit`}
                                        title="Edit kit"
                                    >
                                        {carried.map(({ itemId, qty }, index) => {
                                            const name = tables.Item.get(itemId)?.displayName ?? itemId;
                                            return <EquipIcon key={`${itemId}-${index}`} name={name} qty={qty} mini />;
                                        })}
                                        {Array.from({ length: emptySlots }, (_, index) => (
                                            <span
                                                key={`empty-${index}`}
                                                className="equip-icon equip-icon--mini equip-icon--empty"
                                                aria-hidden="true"
                                            />
                                        ))}
                                    </button>
                                ) : null}

                                {/* Hangs off the slot's own corner, outside its overflow: hidden — same
                                    convention as the float above, and as a carried item's own corner
                                    remove — rather than sitting inset inside the card it's clearing. */}
                                {occupant ? (
                                    <button
                                        type="button"
                                        className="slot__remove"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onUnassign(slot.slotId);
                                        }}
                                        aria-label={`Remove ${runtimeAgent.displayName(occupant)}`}
                                    >
                                        −
                                    </button>
                                ) : null}

                                <div
                                    className={className}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const raw = event.dataTransfer.getData('text/plain');
                                        if (!raw) return;
                                        const payload = parseAgentDragPayload(raw);
                                        if (payload) onDropAgent(slot.slotId, payload.characterId, payload.fromSlotId);
                                    }}
                                >
                                    {/* Only an empty slot needs to say what it wants — once it's filled, the
                                        agent card itself is the answer, and hiding this row hands its
                                        space to the card instead. */}
                                    {occupant ? null : (
                                        <div className="slot__head">
                                            <span className="micro">
                                                {slot.slotId.replace(/^slot_/, '')}
                                                {slot.isMandatory ? '' : ' · optional'}
                                            </span>
                                        </div>
                                    )}

                                    {occupant ? (
                                        <div
                                            className="slot__filled"
                                            onClick={() => onPickSlot(slot.slotId)}
                                            role={pickingAgentId ? 'button' : undefined}
                                        >
                                            <AgentCard agent={occupant} size="sm" draggable dragFromSlotId={slot.slotId} />
                                            <StatHexagon agent={occupant} mini />
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            className="slot__empty"
                                            aria-pressed={isTarget}
                                            onClick={() => onPickSlot(slot.slotId)}
                                        >
                                            {pickingAgentId
                                                ? 'Tap to assign'
                                                : isTarget
                                                  ? 'Pick an agent below'
                                                  : 'Select an agent, drag one, or tap here first'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

            {failure ? <div className="meta danger">{failure}</div> : null}
        </div>
    );
}

/** Country and state ids are authored lowercase; they read as an address, so present them as one. */
function titleCase(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function formatCoordinate(value: number | undefined, positive: string, negative: string): string {
    if (typeof value !== 'number') return '';
    return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}
