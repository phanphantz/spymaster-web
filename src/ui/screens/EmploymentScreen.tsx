import type { ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import { StatLine } from '../components/bits';

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
                        <button
                            type="button"
                            key={agent.characterId}
                            className={isPicked ? 'candidate-card candidate-card--picked' : 'candidate-card'}
                            onClick={() => togglePicked(agent.characterId)}
                            disabled={isBlocked}
                            aria-pressed={isPicked}
                        >
                            <span className="agent-card__name">{runtimeAgent.displayName(agent)}</span>
                            <span className="agent-card__real">
                                {runtimeAgent.fullName(agent)} · {agent.data.rarity ?? 'common'}
                            </span>
                            <StatLine agent={agent} />
                            <p className="candidate-card__bio">{agent.character?.description}</p>
                            <p className="candidate-card__bio dim">
                                {(agent.data.tags ?? []).join(' · ')}
                            </p>
                        </button>
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
