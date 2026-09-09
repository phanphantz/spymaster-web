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
    Modal,
    StatAbbr,
    StatHexagon,
    parseAgentDragPayload,
} from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { GameTables, StatId } from '../../engine/types';
import type { LoadoutSession } from '../../engine/loadout';
import type { LiveMission } from '../../engine/missionFeed';
import { previewReward } from '../../engine/missionPreview';

/** Every agent currently occupying a slot, in slot order. */
function assignedAgentsOf(session: LoadoutSession): RuntimeAgent[] {
    return session.slots
        .map((slot) => session.agentIn(slot.slotId))
        .filter((agent): agent is RuntimeAgent => agent !== undefined);
}

/** Per-stat sum across a set of agents — the team's combined hexagon reads this, not any one agent's. */
function combinedStats(agents: readonly RuntimeAgent[]): Map<StatId, number> {
    const totals = new Map<StatId, number>();
    for (const stat of STAT_IDS) {
        totals.set(stat, agents.reduce((sum, agent) => sum + runtimeAgent.effectiveStats(agent).get(stat), 0));
    }
    return totals;
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
    const decline = useGame((state) => state.declineMission);
    const deploy = useGame((state) => state.deployMission);
    const unassignAgent = useGame((state) => state.unassignAgent);
    const discardCarriedItems = useGame((state) => state.discardCarriedItems);
    const pickingAgentId = useGame((state) => state.pickingAgentId);
    const pickingSlotId = useGame((state) => state.pickingSlotId);
    const pickSlot = useGame((state) => state.pickSlot);
    const placeAgent = useGame((state) => state.placeAgent);
    const pendingSwap = useGame((state) => state.pendingSwap);
    const resolveSwap = useGame((state) => state.resolveSwap);
    const cancelSwap = useGame((state) => state.cancelSwap);
    const failure = useGame((state) => state.assignmentFailure);
    const openShop = useGame((state) => state.openShop);

    const [confirmingDecline, setConfirmingDecline] = useState(false);
    const [confirmingClose, setConfirmingClose] = useState(false);
    const [discardTarget, setDiscardTarget] = useState<RuntimeAgent>();

    if (!session || !tables) return null;

    const mission = session.mission;
    const canDecline = mission.data.isDeclinable !== false;
    const hasAssignments = session.assignments.size > 0;
    const assigned = assignedAgentsOf(session);

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
            onClose={() => (hasAssignments ? setConfirmingClose(true) : close())}
            wide
            label={mission.data.displayName ?? 'Mission'}
        >
            <div className="modal__body">
                <div className="summary">
                    <div className="summary__left">
                        <div className="summary__photo">NO IMAGE</div>
                        <div className="summary__lower-anchor">
                            <hr className="summary__dashrule" />
                            <LocationBlock mission={mission} />
                            <RewardRow mission={mission} tables={tables} />
                        </div>
                    </div>

                    <div className="summary__divider">
                        <span className="summary__dot" aria-hidden="true" />
                    </div>

                    <div className="summary__right">
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

                        <MissionBody
                            mission={mission}
                            tables={tables}
                            session={session}
                            pickingAgentId={pickingAgentId}
                            pickingSlotId={pickingSlotId}
                            onPickSlot={pickSlot}
                            onDropAgent={placeAgent}
                            onUnassign={unassignAgent}
                            onEdit={openShop}
                            onDiscardItems={setDiscardTarget}
                            failure={failure}
                        />
                    </div>

                    <div className="summary__stats">
                        <div className="summary__photo summary__photo--stats">
                            <StatHexagon totals={combinedStats(assigned)} />
                        </div>
                        <div className="summary__lower-anchor">
                            <hr className="summary__dashrule" />
                            <StatGaugeList agents={assigned} tables={tables} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="modal__footer">
                <button
                    type="button"
                    className="btn btn--quiet footer-left"
                    onClick={() => setConfirmingDecline(true)}
                    disabled={!canDecline}
                    title={canDecline ? undefined : 'This client does not take no for an answer'}
                >
                    Decline
                </button>
                <span className="meta">
                    {session.canConfirm
                        ? 'Ready to deploy'
                        : `Fill ${session.missingMandatorySlots.length} more slot(s)`}
                </span>
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={deploy}
                    disabled={!session.canConfirm}
                >
                    Deploy
                </button>
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
                message="Every assigned agent will be pulled off this job and anything they're carrying returned to stock. Nothing is lost — but you'll have to build the team again."
                confirmLabel="Close"
                danger
                onConfirm={() => {
                    setConfirmingClose(false);
                    close();
                }}
                onCancel={() => setConfirmingClose(false)}
            />

            <ConfirmDialog
                open={Boolean(discardTarget)}
                title="Discard all items?"
                message={
                    discardTarget
                        ? `Everything ${runtimeAgent.displayName(discardTarget)} is carrying returns to stock.`
                        : undefined
                }
                confirmLabel="Discard"
                danger
                onConfirm={() => {
                    if (discardTarget) discardCarriedItems(discardTarget.characterId);
                    setDiscardTarget(undefined);
                }}
                onCancel={() => setDiscardTarget(undefined)}
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

/** Payment and exp, sitting under the location info group at the foot of the left column. */
function RewardRow({ mission, tables }: { mission: LiveMission; tables: GameTables }): ReactNode {
    const reward = previewReward(tables, mission.data.outcomes?.[0]);

    return (
        <div className="summary__rewards">
            <div className="reward-row">
                <div className="reward-box hatch">
                    <span className="reward-box__icon" aria-hidden="true">💰</span>
                    <span className="reward-box__value">
                        {reward.money ? `$${reward.money.toLocaleString('en-US')}` : '—'}
                    </span>
                    <span className="reward-box__unit">payment</span>
                </div>
                <div className="reward-box hatch">
                    <span className="reward-box__icon" aria-hidden="true">⭐</span>
                    <span className="reward-box__value">{reward.exp || '—'}</span>
                    <span className="reward-box__unit">exp</span>
                </div>
            </div>
        </div>
    );
}

/** Location name, address and coordinates, sitting under the photo's fade. */
function LocationBlock({ mission }: { mission: LiveMission }): ReactNode {
    const [expanded, setExpanded] = useState(false);
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

            {expanded ? (
                <span className="summary__location-detail dim">
                    {[location?.type, location?.locationSize, location?.state]
                        .filter(Boolean)
                        .join(' · ') || 'No further detail on file'}
                </span>
            ) : null}

            {/* UIMissionLink. There is no deeper location view in v1, so it discloses the rest of
                what the Location row actually carries rather than pretending to navigate. */}
            <button type="button" className="mission-link" onClick={() => setExpanded(!expanded)}>
                {expanded ? '‹ Less' : 'More ›'}
            </button>
        </div>
    );
}

/**
 * Tasks, rewards and the team's slot grid, stacked on one page.
 *
 * The sketch puts a Task list here. v1 cuts Tasks, so the list renders whatever `starterTasks`
 * resolves to and says plainly when there is nothing — which is honest now and fills itself in
 * once Tasks are authored, rather than needing this rewritten.
 *
 * The slot grid below it is the real, interactive Loadout — pick an agent from the roster strip
 * below the modal, then tap a slot, or tap an empty slot first and pick the agent after; either
 * order lands the same placement. An occupied slot clears with its 'x'. What that agent carries
 * lives on its own page, opened with the pencil — a slot has no room for a kit list.
 */
function MissionBody({
    mission,
    tables,
    session,
    pickingAgentId,
    pickingSlotId,
    onPickSlot,
    onDropAgent,
    onUnassign,
    onEdit,
    onDiscardItems,
    failure,
}: {
    mission: LiveMission;
    tables: GameTables;
    session: LoadoutSession;
    pickingAgentId: string | undefined;
    pickingSlotId: string | undefined;
    onPickSlot: (slotId: string) => void;
    onDropAgent: (slotId: string, characterId: string, fromSlotId?: string) => void;
    onUnassign: (slotId: string) => void;
    onEdit: (characterId: string) => void;
    onDiscardItems: (agent: RuntimeAgent) => void;
    failure: string;
}): ReactNode {
    const tasks = tables.Task.getMany(mission.data.starterTasks);

    return (
        <div className="mission-body">
            <div>
                <div className="summary__label">Tasks</div>
                <div className="marker-list">
                    {tasks.length ? (
                        tasks.map((task) => (
                            <div className="marker-row" key={task.taskId}>
                                <span className="marker" />
                                <span>{task.displayName ?? task.taskId}</span>
                                <span className="marker-row__note">
                                    {task.minDurationInHours ? `${task.minDurationInHours}h` : ''}
                                </span>
                            </div>
                        ))
                    ) : (
                        <div className="marker-row">
                            <span className="marker" />
                            <span className="dim">
                                Single operation. Tasks are not modelled in this prototype.
                            </span>
                            <span />
                        </div>
                    )}
                </div>
            </div>

            <div className="summary__lower-anchor">
                <div className="summary__label">Team</div>
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

                        return (
                            <div
                                className={className}
                                key={slot.slotId}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    const raw = event.dataTransfer.getData('text/plain');
                                    if (!raw) return;
                                    const payload = parseAgentDragPayload(raw);
                                    if (payload) onDropAgent(slot.slotId, payload.characterId, payload.fromSlotId);
                                }}
                            >
                                <div className="slot__head">
                                    <span className="micro">
                                        {slot.slotId.replace(/^slot_/, '')}
                                        {slot.isMandatory ? '' : ' · optional'}
                                    </span>
                                </div>

                                {occupant ? (
                                    <div
                                        className="slot__filled"
                                        onClick={() => onPickSlot(slot.slotId)}
                                        role={pickingAgentId ? 'button' : undefined}
                                    >
                                        <div className="slot__actions">
                                            <button
                                                type="button"
                                                className="slot__edit"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onEdit(occupant.characterId);
                                                }}
                                                aria-label={`Edit ${runtimeAgent.displayName(occupant)}'s kit`}
                                                title="Edit kit"
                                            >
                                                ✎
                                            </button>
                                            <button
                                                type="button"
                                                className="slot__remove"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onUnassign(slot.slotId);
                                                }}
                                                aria-label={`Remove ${runtimeAgent.displayName(occupant)}`}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <AgentCard agent={occupant} size="sm" draggable dragFromSlotId={slot.slotId} />
                                        {(() => {
                                            const carried = session.carriedBy(occupant.characterId).entries;
                                            const capacity = runtimeAgent.inventorySize(occupant);
                                            const carriedTotal = carried.reduce((sum, [, qty]) => sum + qty, 0);
                                            const emptySlots = Math.max(0, capacity - carriedTotal);
                                            if (capacity <= 0) return null;

                                            return (
                                                <>
                                                    <div className="slot__items">
                                                        {carried.map(([itemId, qty]) => {
                                                            const name = tables.Item.get(itemId)?.displayName ?? itemId;
                                                            return <EquipIcon key={itemId} name={name} qty={qty} mini />;
                                                        })}
                                                        {Array.from({ length: emptySlots }, (_, index) => (
                                                            <span
                                                                key={`empty-${index}`}
                                                                className="equip-icon equip-icon--mini equip-icon--empty"
                                                                aria-hidden="true"
                                                            />
                                                        ))}
                                                    </div>
                                                    {carried.length > 0 ? (
                                                        <button
                                                            type="button"
                                                            className="slot__discard"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onDiscardItems(occupant);
                                                            }}
                                                            aria-label={`Discard everything ${runtimeAgent.displayName(occupant)} is carrying`}
                                                            title="Discard all items"
                                                        >
                                                            🗑
                                                        </button>
                                                    ) : null}
                                                </>
                                            );
                                        })()}
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
                        );
                    })}
                </div>

                {failure ? <div className="meta danger">{failure}</div> : null}
            </div>
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
