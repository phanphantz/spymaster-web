import type { ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import { AgentCard, StatHexagon } from '../components/bits';

/**
 * Employment: pick a roster out of a shortlist.
 *
 * A reward phase, not a purchase — there is no hiring cost anywhere in the design. Every agent is
 * in the pool for v1, so nothing is locked; the choice is which four you want to live with.
 */
export function EmploymentScreen(): ReactNode {
    const offer = useGame((state) => state.offer);
    const picked = useGame((state) => state.picked);
    const togglePicked = useGame((state) => state.togglePicked);
    const confirm = useGame((state) => state.confirmEmployment);
    const tables = useGame((state) => state.tables);

    if (!offer) return null;

    const remaining = offer.pickQty - picked.length;

    return (
        <div className="employment">
            <div>
                <h1 className="title">Employment</h1>
                <p className="summary__body" style={{ maxWidth: '62ch' }}>
                    Eight people are available. You can afford to keep {offer.pickQty}. Read them
                    carefully — stats decide who clears a slot, and the ones you leave behind are not
                    coming back this run.
                </p>
            </div>

            <div className="candidate-grid">
                {offer.candidates.map((agent) => {
                    const isPicked = picked.includes(agent.characterId);
                    const isBlocked = !isPicked && remaining === 0;

                    return (
                        <div
                            key={agent.characterId}
                            className={isPicked ? 'candidate-card candidate-card--picked' : 'candidate-card'}
                        >
                            <AgentCard
                                agent={agent}
                                size="sm"
                                selected={isPicked}
                                disabled={isBlocked}
                                onClick={() => togglePicked(agent.characterId)}
                            />
                            <span className="agent-card__real">{runtimeAgent.fullName(agent)}</span>
                            <StatHexagon agent={agent} />
                            <div className="skill-list">
                                {(agent.data.baseSkillIds ?? []).map((skillId) => (
                                    <div className="skill-row" key={skillId}>
                                        {tables?.Skill.get(skillId)?.displayName ?? skillId}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="modal__footer">
                <span className="meta">
                    {remaining > 0 ? `Choose ${remaining} more` : 'Roster complete'}
                </span>
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={confirm}
                    disabled={remaining !== 0}
                >
                    Begin
                </button>
            </div>
        </div>
    );
}
