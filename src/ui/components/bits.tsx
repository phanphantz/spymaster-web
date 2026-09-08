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

/**
 * Bolds the terms that matter — a location, a slot tag, a sum of money, a duration — inside a run of
 * authored prose, so the objective-relevant facts read at a glance instead of hiding in the copy.
 */
export function Emphasized({ text, terms = [] }: { text: string; terms?: string[] }): ReactNode {
    const escaped = terms.filter(Boolean).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = [...escaped, String.raw`\$[\d,]+`, String.raw`\b\d+h\b`, String.raw`\b\d+%`].join('|');
    const parts = text.split(new RegExp(`(${pattern})`, 'gi'));

    return (
        <>
            {parts.map((part, index) =>
                index % 2 === 1 ? (
                    <strong className="kw" key={index}>
                        {part}
                    </strong>
                ) : (
                    part
                ),
            )}
        </>
    );
}

/** A reusable yes/no dialog for actions that need one more tap to confirm. */
export function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger,
    onConfirm,
    onCancel,
}: {
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}): ReactNode {
    if (!open) return null;

    return (
        <div className="backdrop" onClick={onCancel} role="presentation">
            <div
                className="confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
            >
                <h3 className="confirm__title">{title}</h3>
                {message ? <p className="confirm__body">{message}</p> : null}
                <div className="confirm__actions">
                    <button type="button" className="btn btn--quiet" onClick={onCancel}>
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={danger ? 'btn btn--danger' : 'btn btn--primary'}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
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
