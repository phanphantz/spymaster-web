import { useState, type ReactNode } from 'react';
import { previewReward, slotCountFor } from '../../engine/missionPreview';
import type { LiveMission } from '../../engine/missionFeed';
import type { GameTables } from '../../engine/types';
import { DifficultyPips } from '../components/bits';

const COLLAPSED_KEY = 'spymaster.contracts.collapsed';

/** Whatever the player last chose; before that, open on a desktop and folded on a phone, where an
 *  open panel would cover most of the map. */
function initialCollapsed(): boolean {
    try {
        const stored = localStorage.getItem(COLLAPSED_KEY);
        if (stored !== null) return stored === '1';
    } catch {
        // Storage can be blocked (private mode, sandboxed frames) — fall through to the default.
    }
    return window.matchMedia('(max-width: 600px)').matches;
}

interface ContractsPanelProps {
    pending: readonly LiveMission[];
    tables: GameTables | undefined;
    /** The mission whose pin or row is under the pointer. */
    hotId?: string;
    onHover: (instanceId: string | undefined) => void;
    onOpen: (mission: LiveMission) => void;
    onDecline: (mission: LiveMission) => void;
}

/**
 * The contract board, floating over the world map's top-right corner. Folds to its header — the
 * count stays visible, and pulses when a contract arrives, so a folded board still says when there
 * is work.
 */
export function ContractsPanel({ pending, tables, hotId, onHover, onOpen, onDecline }: ContractsPanelProps): ReactNode {
    const [collapsed, setCollapsed] = useState(initialCollapsed);

    const toggle = () => {
        const next = !collapsed;
        setCollapsed(next);
        try {
            localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
        } catch {
            // Not remembered, but still toggled.
        }
    };

    return (
        <section className={collapsed ? 'contracts contracts--collapsed' : 'contracts'} aria-label="Contracts" data-map-occluder>
            <button type="button" className="contracts__header" aria-expanded={!collapsed} aria-controls="contracts-body" onClick={toggle}>
                <span className="contracts__title">Contracts</span>
                {/* Keyed on the count so the arrival pulse replays for every new contract. */}
                <span key={pending.length} className={pending.length > 0 ? 'contracts__count contracts__count--live' : 'contracts__count'}>
                    {pending.length}
                </span>
                <span className="contracts__chevron" aria-hidden="true" />
            </button>

            {collapsed ? null : (
                <div className="contracts__body" id="contracts-body">
                    {pending.length === 0 ? (
                        <p className="contracts__empty meta">
                            No contracts on the board. Work arrives on the clock — raise the speed, or skip ahead.
                        </p>
                    ) : (
                        <div className="mission-list">
                            {pending.map((mission) => {
                                const reward = tables ? previewReward(tables, mission.data.outcomes?.[0]) : { money: 0, exp: 0 };
                                const slots = tables ? slotCountFor(mission, tables) : { mandatory: 0, total: 0 };
                                const canDecline = mission.data.isDeclinable !== false;

                                return (
                                    <div
                                        className={mission.instanceId === hotId ? 'mission-row mission-row--hot' : 'mission-row'}
                                        key={mission.instanceId}
                                        onPointerEnter={() => onHover(mission.instanceId)}
                                        onPointerLeave={() => onHover(undefined)}
                                    >
                                        <button type="button" className="mission-row__open" onClick={() => onOpen(mission)}>
                                            <DifficultyPips level={mission.data.difficultyLevel} />
                                            <span className="mission-row__info">
                                                <span className="mission-row__name">{mission.data.displayName}</span>
                                                <br />
                                                <span className="mission-row__where">
                                                    {mission.location?.displayName ?? 'Unknown'} · {mission.data.type ?? 'contract'} ·{' '}
                                                    {slots.mandatory} agent{slots.mandatory === 1 ? '' : 's'}
                                                </span>
                                            </span>
                                        </button>

                                        <span className="mission-row__rewards">
                                            <span className="mission-row__reward" title="Payment">
                                                <span aria-hidden="true">💰</span> x{reward.money.toLocaleString('en-US')}
                                            </span>
                                            <span className="mission-row__reward" title="Experience">
                                                <span aria-hidden="true">⭐</span> x{reward.exp}
                                            </span>
                                        </span>

                                        {canDecline ? (
                                            <button
                                                type="button"
                                                className="btn btn--small btn--quiet mission-row__decline"
                                                onClick={() => onDecline(mission)}
                                            >
                                                Decline
                                            </button>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
