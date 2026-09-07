import type { ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import { DifficultyPips, Modal } from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { SlotRequirementData } from '../../engine/types';

/**
 * The Mission Summary UI: read the contract, then accept or decline.
 *
 * It shows the hint, which is authored and may be deliberately oblique, and the shape of the slots
 * the job needs. It does **not** show a success chance, because none is computed — the result is
 * whichever authored Outcome tier the loadout clears.
 */
export function MissionSummary(): ReactNode {
    useGame((state) => state.version);

    const tables = useGame((state) => state.tables);
    const pending = useGame((state) => state.pending);
    const selectedInstanceId = useGame((state) => state.selectedInstanceId);
    const close = useGame((state) => state.closeOverlay);
    const decline = useGame((state) => state.declineMission);
    const accept = useGame((state) => state.acceptMission);

    const mission = pending.find((candidate) => candidate.instanceId === selectedInstanceId);
    if (!mission || !tables) return null;

    const startGate = tables.Gate.get(mission.data.gateId);
    const slots = (startGate?.slotReqIds ?? []).map((slotId) => tables.SlotRequirement.get(slotId));
    const canDecline = mission.data.isDeclinable !== false;

    return (
        <Modal onClose={close} label={mission.data.displayName ?? 'Mission'}>
            <div className="modal__body">
                <div className="summary">
                    <div className="summary__left">
                        <div className="summary__photo">NO IMAGE</div>

                        <div>
                            <div className="title">{mission.location?.displayName ?? 'Unknown'}</div>
                            <div className="micro dim">
                                {formatCoordinate(mission.location?.latitude, 'N', 'S')}{' '}
                                {formatCoordinate(mission.location?.longitude, 'E', 'W')}
                            </div>
                        </div>

                        <hr className="rule" />

                        <dl style={{ margin: 0, display: 'grid', gap: 8 }}>
                            <div className="kv">
                                <dt>Contract</dt>
                                <dd>{mission.data.missionId}</dd>
                            </div>
                            <div className="kv">
                                <dt>Priority</dt>
                                <dd>{mission.data.priorityType ?? '—'}</dd>
                            </div>
                            <div className="kv">
                                <dt>Difficulty</dt>
                                <dd>
                                    <DifficultyPips level={mission.data.difficultyLevel} />
                                </dd>
                            </div>
                            <div className="kv">
                                <dt>Declinable</dt>
                                <dd className={canDecline ? undefined : 'danger'}>
                                    {canDecline ? 'Yes' : 'No'}
                                </dd>
                            </div>
                        </dl>
                    </div>

                    <div className="summary__right">
                        <h2 className="summary__name">{mission.data.displayName}</h2>

                        <div className="summary__row">
                            <span className="chip">{mission.data.type ?? 'contract'}</span>
                            <span className="meta">{slots.length} slots</span>
                        </div>

                        <p className="summary__body">{mission.data.description}</p>

                        {mission.data.hint ? <p className="hint">“{mission.data.hint}”</p> : null}

                        <div>
                            <div className="micro" style={{ marginBottom: 8 }}>
                                Required team
                            </div>
                            <div className="slot-preview">
                                {slots.map((slot, index) => (
                                    <div className="slot-preview__row" key={slot?.slotId ?? index}>
                                        <span>{slotLabel(slot)}</span>
                                        <span className="dim">{describeRequirement(slot)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="micro" style={{ marginBottom: 8 }}>
                                On success
                            </div>
                            <p className="meta">{describeReward(tables, mission.data.outcomes?.[0])}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="modal__footer">
                <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => decline(mission.instanceId)}
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
                    Accept
                </button>
            </div>
        </Modal>
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
    for (const stat of STAT_IDS) {
        const value = slot[stat];
        if (value) parts.push(`${stat.toUpperCase()} ${value}+`);
    }
    for (const tag of slot.tags ?? []) parts.push(tag);
    for (const tag of slot.excludedTags ?? []) parts.push(`no ${tag}`);

    return parts.length ? parts.join(' · ') : 'anyone';
}

function describeReward(
    tables: NonNullable<ReturnType<typeof useGame.getState>['tables']>,
    bestOutcomeId: string | undefined,
): string {
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

    if (!money && !exp) return 'Terms not stated.';
    return `$${money.toLocaleString('en-US')} and ${exp} EXP, if it goes well.`;
}

function formatCoordinate(value: number | undefined, positive: string, negative: string): string {
    if (typeof value !== 'number') return '';
    return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}
