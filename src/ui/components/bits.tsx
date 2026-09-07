import type { ReactNode } from 'react';
import * as runtimeAgent from '../../engine/runtimeAgent';
import type { RuntimeAgent } from '../../engine/runtimeAgent';
import { STAT_IDS } from '../../engine/types';

/** Small shared pieces. Anything used on two screens lives here rather than being copied. */

export function Money({ amount }: { amount: number }): ReactNode {
    return <span className="money">${amount.toLocaleString('en-US')}</span>;
}

/** Difficulty as diamonds, the way the Unity Mission Summary shows it — no number, no percentage. */
export function DifficultyPips({ level = 0, max = 4 }: { level?: number; max?: number }): ReactNode {
    return (
        <span className="pips" aria-label={`Difficulty ${level} of ${max}`}>
            {Array.from({ length: max }, (_, index) => (
                <span key={index} className={index < level ? 'pip pip--on' : 'pip'} />
            ))}
        </span>
    );
}

export function StatLine({ agent }: { agent: RuntimeAgent }): ReactNode {
    const stats = runtimeAgent.effectiveStats(agent);
    return (
        <div className="statline">
            {STAT_IDS.map((stat) => (
                <span key={stat}>
                    {stat.toUpperCase()} <b>{stats.get(stat)}</b>
                </span>
            ))}
        </div>
    );
}

export function HealthBar({ agent }: { agent: RuntimeAgent }): ReactNode {
    const max = runtimeAgent.maxHealth(agent);
    const ratio = max > 0 ? agent.currentHealth / max : 0;
    return (
        <div
            className="healthbar"
            title={`${agent.currentHealth} / ${max} health`}
            role="img"
            aria-label={`Health ${agent.currentHealth} of ${max}`}
        >
            <div
                className={ratio < 0.5 ? 'healthbar__fill healthbar__fill--hurt' : 'healthbar__fill'}
                style={{ width: `${Math.round(ratio * 100)}%` }}
            />
        </div>
    );
}

export function AgentCard({
    agent,
    selected,
    disabled,
    onClick,
}: {
    agent: RuntimeAgent;
    selected?: boolean;
    disabled?: boolean;
    onClick?: () => void;
}): ReactNode {
    const className = [
        'agent-card',
        selected ? 'agent-card--selected' : '',
        disabled ? 'agent-card--disabled' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <button type="button" className={className} onClick={onClick} disabled={!onClick}>
            <span className="agent-card__name">{runtimeAgent.displayName(agent)}</span>
            <span className="agent-card__real">{runtimeAgent.fullName(agent)}</span>
            <StatLine agent={agent} />
            <HealthBar agent={agent} />
        </button>
    );
}

export function Modal({
    children,
    onClose,
    wide,
    label,
}: {
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
    label: string;
}): ReactNode {
    return (
        <div
            className="backdrop"
            // Clicking the backdrop dismisses; clicking inside the panel must not.
            onClick={onClose}
            role="presentation"
        >
            <div
                className={wide ? 'modal modal--wide' : 'modal'}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                onClick={(event) => event.stopPropagation()}
            >
                <button type="button" className="icon-btn modal__close" onClick={onClose} aria-label="Close">
                    ✕
                </button>
                {children}
            </div>
        </div>
    );
}
