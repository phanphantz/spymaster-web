import type { ReactNode } from 'react';
import { SPEED_STEPS } from '../../engine/clock';
import { useGame } from '../../store/gameStore';
import { AgentCard, DifficultyPips, Money } from '../components/bits';

/**
 * The World Map, as a list.
 *
 * v1 has no map — the design's map is a camera over a globe, and none of what it adds is what this
 * prototype is trying to answer. Missions still arrive on the clock through the real Feed, so the
 * pacing question the map exists to serve is still being asked.
 */
export function WorldMapScreen(): ReactNode {
    // Subscribing to version is what makes the engine's mutable objects reactive.
    useGame((state) => state.version);

    const pending = useGame((state) => state.pending);
    const roster = useGame((state) => state.roster);
    const openMission = useGame((state) => state.openMission);

    return (
        <div className="worldmap">
            {pending.length === 0 ? (
                <div className="empty-state">
                    <p>No contracts on the board.</p>
                    <p className="meta">
                        Work arrives on the clock. Raise the speed, or skip ahead, and wait for the
                        phone to ring.
                    </p>
                </div>
            ) : (
                <div className="mission-list">
                    {pending.map((mission) => (
                        <button
                            type="button"
                            key={mission.instanceId}
                            className="mission-row"
                            onClick={() => openMission(mission.instanceId)}
                        >
                            <DifficultyPips level={mission.data.difficultyLevel} />
                            <span>
                                <span className="mission-row__name">{mission.data.displayName}</span>
                                <br />
                                <span className="mission-row__where">
                                    {mission.location?.displayName ?? 'Unknown'} ·{' '}
                                    {mission.data.type ?? 'contract'}
                                </span>
                            </span>
                            <span className="micro">Open ›</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="roster">
                {roster.length === 0 ? (
                    <span className="meta">No agents employed.</span>
                ) : (
                    roster.map((agent) => <AgentCard key={agent.characterId} agent={agent} />)
                )}
            </div>
        </div>
    );
}

export function TopBar(): ReactNode {
    useGame((state) => state.version);

    const clock = useGame((state) => state.clock);
    const money = useGame((state) => state.money());
    const setSpeedIndex = useGame((state) => state.setSpeedIndex);
    const speedIndex = useGame((state) => state.speedIndex());
    const skipAhead = useGame((state) => state.skipAhead);

    return (
        <header className="topbar">
            <span className="brand">SPYMASTER</span>

            <div className="clock-readout">
                <span className="clock-readout__time">{clock.timeOfDay}</span>
                <span className="micro">Day {clock.totalDays + 1}</span>
            </div>

            <div className="speed-rail" role="group" aria-label="Game speed">
                {SPEED_STEPS.map((step, index) => (
                    <button
                        type="button"
                        key={step}
                        className="speed-rail__step"
                        aria-pressed={speedIndex === index}
                        onClick={() => setSpeedIndex(index)}
                    >
                        x{step}
                    </button>
                ))}
                {/* An hour of in-game time, for when the board is empty and the point is the next
                    contract rather than the wait. */}
                <button type="button" className="btn btn--small btn--quiet" onClick={() => skipAhead(60)}>
                    Skip 1h
                </button>
            </div>

            <div className="money-box">
                <span className="money-box__value">
                    <Money amount={money} />
                </span>
                <span className="micro">USD</span>
            </div>
        </header>
    );
}
