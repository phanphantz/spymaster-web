import { useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import type { RuntimeAgent } from '../../engine/runtimeAgent';
import { AgentCard, ConfirmDialog, DifficultyPips, Emphasized, EquipIcon, Modal, StatHexagon } from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { GameTables, StatId } from '../../engine/types';
import type { LoadoutSession } from '../../engine/loadout';
import type { LiveMission } from '../../engine/missionFeed';

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
 * The Mission UI: read the contract, build the team, then deploy or decline.
 *
 * Follows `UIMissionSummary` in `UI_DESIGN_SYSTEM.md` §5.3 for the briefing half — photo and
 * location on the left, the briefing on the right, split by a steel rule carrying a notification
 * dot. Assignment happens in the same modal rather than handing off to a separate Loadout page: the
 * Loadout session is stood up the moment the mission opens, and the Assignment tab is that session's
 * real, interactive slot grid, not a preview of it.
 *
 * It shows the hint, which is authored and may be deliberately oblique, and what the job demands of
 * a team. It does **not** show a success chance, because none is computed — the result is whichever
 * authored Outcome tier the loadout clears.
 */
export function MissionSummary(): ReactNode {
    useGame((state) => state.version);

    const tables = useGame((state) => state.tables);
    const session = useGame((state) => state.session);
    const roster = useGame((state) => state.roster);
    const close = useGame((state) => state.closeOverlay);
    const decline = useGame((state) => state.declineMission);
    const deploy = useGame((state) => state.deployMission);
    const unassignAgent = useGame((state) => state.unassignAgent);
    const pickingAgentId = useGame((state) => state.pickingAgentId);
    const pickingSlotId = useGame((state) => state.pickingSlotId);
    const pickSlot = useGame((state) => state.pickSlot);
    const placeAgent = useGame((state) => state.placeAgent);
    const pendingReplace = useGame((state) => state.pendingReplace);
    const resolveReplace = useGame((state) => state.resolveReplace);
    const cancelReplace = useGame((state) => state.cancelReplace);
    const failure = useGame((state) => state.assignmentFailure);
    const tab = useGame((state) => state.missionTab);
    const setTab = useGame((state) => state.setMissionTab);
    const openShop = useGame((state) => state.openShop);

    const [confirmingDecline, setConfirmingDecline] = useState(false);
    const [confirmingClose, setConfirmingClose] = useState(false);

    if (!session || !tables) return null;

    const mission = session.mission;
    const canDecline = mission.data.isDeclinable !== false;
    const hasAssignments = session.assignments.size > 0;

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
                        {tab === 'assignment' ? (
                            <div className="summary__photo summary__photo--stats">
                                <StatHexagon totals={combinedStats(assignedAgentsOf(session))} />
                            </div>
                        ) : (
                            <div className="summary__photo">NO IMAGE</div>
                        )}
                        <hr className="summary__dashrule" />
                        <LocationBlock mission={mission} />
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

                        <div className="tabrow" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                className="tabrow__tab"
                                aria-selected={tab === 'details'}
                                onClick={() => setTab('details')}
                            >
                                Details
                            </button>
                            <button
                                type="button"
                                role="tab"
                                className="tabrow__tab"
                                aria-selected={tab === 'assignment'}
                                onClick={() => setTab('assignment')}
                            >
                                Assignment
                            </button>
                        </div>

                        {tab === 'details' ? (
                            <DetailsTab mission={mission} tables={tables} />
                        ) : (
                            <AssignmentTab
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
                        )}
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

            <ReplaceAgentDialog
                pendingReplace={pendingReplace}
                session={session}
                roster={roster}
                onKeep={() => resolveReplace(true)}
                onDiscard={() => resolveReplace(false)}
                onCancel={cancelReplace}
            />
        </Modal>
    );
}

/**
 * Dropping — or picking, either order — an agent onto a slot that already holds someone carrying
 * items pauses here rather than silently bumping them: keep what fits on the new agent, or return
 * it all to stock. Nothing is destroyed either way, only Keep can leave some behind if the new
 * agent's capacity is smaller than what the old one was carrying.
 */
function ReplaceAgentDialog({
    pendingReplace,
    session,
    roster,
    onKeep,
    onDiscard,
    onCancel,
}: {
    pendingReplace: { slotId: string; characterId: string } | undefined;
    session: LoadoutSession;
    roster: readonly RuntimeAgent[];
    onKeep: () => void;
    onDiscard: () => void;
    onCancel: () => void;
}): ReactNode {
    if (!pendingReplace) return null;

    const previous = session.agentIn(pendingReplace.slotId);
    const incoming = roster.find((agent) => agent.characterId === pendingReplace.characterId);
    if (!previous || !incoming) return null;

    const carried = session.carriedBy(previous.characterId).entries;
    const carriedTotal = carried.reduce((sum, [, qty]) => sum + qty, 0);
    const newCapacity = runtimeAgent.inventorySize(incoming);
    const wontFit = Math.max(0, carriedTotal - newCapacity);

    return (
        <div className="backdrop" onClick={onCancel} role="presentation">
            <div
                className="confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label="Replace agent"
                onClick={(event) => event.stopPropagation()}
            >
                <h3 className="confirm__title">Replace {runtimeAgent.displayName(previous)}?</h3>
                <p className="confirm__body">
                    {runtimeAgent.displayName(incoming)} takes this slot instead.{' '}
                    {runtimeAgent.displayName(previous)} is carrying {carriedTotal}{' '}
                    item{carriedTotal === 1 ? '' : 's'} — keep what fits on{' '}
                    {runtimeAgent.displayName(incoming)}, or return all of it to stock.
                </p>
                <div className="confirm__actions">
                    <button type="button" className="btn btn--quiet" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={onDiscard}>
                        Discard items
                    </button>
                    <button type="button" className="btn btn--primary" onClick={onKeep}>
                        Keep items{wontFit > 0 ? ` (${wontFit} won't fit)` : ''}
                    </button>
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
 * Tasks and rewards.
 *
 * The sketch puts a Task list here. v1 cuts Tasks, so the list renders whatever `starterTasks`
 * resolves to and says plainly when there is nothing — which is honest now and fills itself in
 * once Tasks are authored, rather than needing this rewritten.
 */
function DetailsTab({ mission, tables }: { mission: LiveMission; tables: GameTables }): ReactNode {
    const tasks = tables.Task.getMany(mission.data.starterTasks);
    const reward = rewardOf(tables, mission.data.outcomes?.[0]);

    return (
        <div className="tabpanel" role="tabpanel">
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

            <div>
                <div className="summary__label">Rewards</div>
                <div className="reward-row">
                    <div className="reward-box hatch">
                        <span className="reward-box__value">
                            {reward.money ? `$${reward.money.toLocaleString('en-US')}` : '—'}
                        </span>
                        <span className="reward-box__unit">payment</span>
                    </div>
                    <div className="reward-box hatch">
                        <span className="reward-box__value">{reward.exp || '—'}</span>
                        <span className="reward-box__unit">exp</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Who goes — the real Loadout, in place.
 *
 * A Mission has no slot list of its own — the slots are whatever its start Gate names, in authored
 * order, and `session.slots` is that list. Pick an agent from the roster strip below, then tap a
 * slot — or tap an empty slot first, then pick the agent — either order lands the same placement.
 * An occupied slot clears with its 'x'; the team's combined stats show on the panel's left, not
 * here, so a filled slot stays exactly the footprint of an empty one. What that agent carries lives
 * on its own page now, opened with the pencil — a slot has no room for a kit list.
 */
function AssignmentTab({
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
    onDropAgent: (slotId: string, characterId: string) => void;
    onUnassign: (slotId: string) => void;
    onEdit: (characterId: string) => void;
    failure: string;
}): ReactNode {
    return (
        <div className="tabpanel" role="tabpanel">
            <div className="slot-grid">
                {session.slots.map((slot) => {
                    const occupant = session.agentIn(slot.slotId);
                    const isTarget = slot.slotId === pickingSlotId;
                    // A picked agent (from a click, not mid-drag) could land here and bump someone —
                    // hinted so the slot doesn't just look like a dead end while something is picked.
                    const isReplaceable = Boolean(occupant && pickingAgentId && occupant.characterId !== pickingAgentId);
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
                                const characterId = event.dataTransfer.getData('text/plain');
                                if (characterId) onDropAgent(slot.slotId, characterId);
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
                                    <AgentCard agent={occupant} size="sm" />
                                    {session.carriedBy(occupant.characterId).entries.length > 0 ? (
                                        <div className="slot__items">
                                            {session.carriedBy(occupant.characterId).entries.map(([itemId, qty]) => {
                                                const name = tables.Item.get(itemId)?.displayName ?? itemId;
                                                return <EquipIcon key={itemId} name={name} qty={qty} mini />;
                                            })}
                                        </div>
                                    ) : null}
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
    );
}

function rewardOf(
    tables: GameTables,
    bestOutcomeId: string | undefined,
): { money: number; exp: number } {
    const outcome = tables.Outcome.get(bestOutcomeId);
    const incidents = tables.Incident.getMany(outcome?.incidents);

    let money = 0;
    let exp = 0;
    for (const incident of incidents) {
        exp += incident.rewardExp ?? 0;
        for (const reward of incident.rewardItems ?? []) {
            if (reward.itemId === 'dollar') money += reward.qty ?? 0;
        }
    }

    return { money, exp };
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
