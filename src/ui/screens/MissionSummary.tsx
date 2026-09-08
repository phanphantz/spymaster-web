import { useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import { ConfirmDialog, DifficultyPips, Emphasized, Modal } from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { GameTables, SlotRequirementData } from '../../engine/types';
import type { LiveMission } from '../../engine/missionFeed';

/**
 * The Mission Summary UI: read the contract, then accept or decline.
 *
 * Follows `UIMissionSummary` in `UI_DESIGN_SYSTEM.md` §5.3 — a two-column modal, photo and location
 * on the left, the briefing on the right, split by a steel rule carrying a notification dot.
 *
 * It shows the hint, which is authored and may be deliberately oblique, and what the job demands of
 * a team. It does **not** show a success chance, because none is computed — the result is whichever
 * authored Outcome tier the loadout clears.
 */
export function MissionSummary(): ReactNode {
    useGame((state) => state.version);

    const tables = useGame((state) => state.tables);
    const pending = useGame((state) => state.pending);
    const selectedInstanceId = useGame((state) => state.selectedInstanceId);
    const close = useGame((state) => state.closeOverlay);
    const decline = useGame((state) => state.declineMission);
    const accept = useGame((state) => state.acceptMission);

    const [tab, setTab] = useState<'details' | 'assignment'>('details');
    const [confirmingDecline, setConfirmingDecline] = useState(false);

    const mission = pending.find((candidate) => candidate.instanceId === selectedInstanceId);
    if (!mission || !tables) return null;

    const canDecline = mission.data.isDeclinable !== false;

    const startGate = tables.Gate.get(mission.data.gateId);
    const slots = (startGate?.slotReqIds ?? []).map((slotId) => tables.SlotRequirement.get(slotId));
    const keywordTerms = [
        mission.location?.displayName,
        mission.data.type,
        ...slots.flatMap((slot) => [...(slot?.tags ?? []), ...(slot?.excludedTags ?? [])]),
    ].filter((term): term is string => Boolean(term));

    return (
        <Modal onClose={close} label={mission.data.displayName ?? 'Mission'}>
            <div className="modal__body">
                <div className="summary">
                    <div className="summary__left">
                        <div className="summary__photo">NO IMAGE</div>
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
                            <AssignmentTab slots={slots} />
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
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => accept(mission.instanceId)}
                >
                    Assign
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
        </Modal>
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
 * Who the job needs.
 *
 * A Mission has no slot list of its own — the slots are whatever its start Gate names, in authored
 * order. This is the same list the Loadout page will present.
 */
function AssignmentTab({ slots }: { slots: (SlotRequirementData | undefined)[] }): ReactNode {
    return (
        <div className="tabpanel" role="tabpanel">
            <div className="summary__label">Required team</div>
            <div className="marker-list">
                {slots.map((slot, index) => (
                    <div className="marker-row" key={slot?.slotId ?? index}>
                        <span className="marker" />
                        <span>{slotLabel(slot)}</span>
                        <span className="marker-row__note">{describeRequirement(slot)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function slotLabel(slot: SlotRequirementData | undefined): string {
    if (!slot?.slotId) return 'Open slot';
    const name = slot.slotId.replace(/^slot_/, '').replace(/([A-Z])/g, ' $1');
    return name.charAt(0).toUpperCase() + name.slice(1) + (slot.isMandatory === false ? ' (optional)' : '');
}

/** The demands, without giving away the Outcome Gate — that is what the hint is for. */
function describeRequirement(slot: SlotRequirementData | undefined): string {
    if (!slot) return 'anyone';

    const parts: string[] = [];
    if (slot.minLevel && slot.minLevel > 1) parts.push(`LV ${slot.minLevel}+`);
    for (const stat of STAT_IDS) {
        const value = slot[stat];
        if (value) parts.push(`${stat.toUpperCase()} ${value}+`);
    }
    for (const tag of slot.tags ?? []) parts.push(tag);
    for (const tag of slot.excludedTags ?? []) parts.push(`no ${tag}`);

    return parts.length ? parts.join(' · ') : 'anyone';
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
