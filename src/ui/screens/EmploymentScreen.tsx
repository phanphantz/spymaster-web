import { useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import { AgentCard, StatHexagon } from '../components/bits';

/**
 * Employment: pick a roster out of a shortlist.
 *
 * A reward phase, not a purchase — there is no hiring cost anywhere in the design. Every agent is
 * in the pool for v1, so nothing is locked; the choice is which four you want to live with.
 *
 * The candidate strip at the bottom is the same fixed `.roster` picker every other screen uses —
 * click a card to toggle it into the roster, same as picking an agent for a mission slot. Clicking
 * also focuses that candidate in the stage above, which is the only place their sheet (portrait,
 * hexagon, skills, background) is shown — there's no separate detail modal to keep in sync.
 */
export function EmploymentScreen(): ReactNode {
    const offer = useGame((state) => state.offer);
    const picked = useGame((state) => state.picked);
    const togglePicked = useGame((state) => state.togglePicked);
    const confirm = useGame((state) => state.confirmEmployment);
    const tables = useGame((state) => state.tables);

    const [focusedId, setFocusedId] = useState<string>();

    if (!offer) return null;

    const remaining = offer.pickQty - picked.length;
    const focused = offer.candidates.find((agent) => agent.characterId === focusedId) ?? offer.candidates[0];

    return (
        <div className="employment">
            <h1 className="employment__title">Employment</h1>

            {focused ? (
                <div className="employment__stage">
                    <div
                        className="employment__portrait"
                        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}avatars/${focused.characterId}.png)` }}
                    >
                        <div className="employment__portrait-info">
                            <div className="employment__codename">{runtimeAgent.displayName(focused)}</div>
                            <div className="employment__fullname">{runtimeAgent.fullName(focused)}</div>
                        </div>
                    </div>

                    <div className="employment__aside">
                        <StatHexagon agent={focused} />
                        <div className="skill-list">
                            {(focused.data.baseSkillIds ?? []).map((skillId) => (
                                <div className="skill-row" key={skillId}>
                                    {tables?.Skill.get(skillId)?.displayName ?? skillId}
                                </div>
                            ))}
                        </div>
                        {focused.character?.description ? (
                            <p className="employment__bio">{focused.character.description}</p>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <div className="modal__footer employment__footer">
                <span className="meta">
                    {picked.length} / {offer.pickQty} selected
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

            <div className="roster">
                {offer.candidates.map((agent) => {
                    const isPicked = picked.includes(agent.characterId);
                    const isBlocked = !isPicked && remaining === 0;

                    return (
                        <AgentCard
                            key={agent.characterId}
                            agent={agent}
                            size="sm"
                            selected={isPicked}
                            disabled={isBlocked}
                            onClick={() => {
                                togglePicked(agent.characterId);
                                setFocusedId(agent.characterId);
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
}
