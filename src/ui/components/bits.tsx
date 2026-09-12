import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import type { RuntimeAgent } from '../../engine/runtimeAgent';
import type { SkillData, StatId } from '../../engine/types';

/** Small shared pieces. Anything used on two screens lives here rather than being copied. */

/** What a drop target reads back — set by AgentCard's onDragStart. `fromSlotId` is present only
 *  when the drag started on a slot's own card rather than the roster's, so a drop target can tell
 *  "assign from the roster" apart from "moved from another slot" (a relocate, or half of a swap). */
export function parseAgentDragPayload(raw: string): { characterId: string; fromSlotId?: string } | undefined {
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed?.characterId === 'string' ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/** What a Kit item tile's drag reads back — dropped on an agent inventory slot to equip it (which
 *  refuses on its own if the item isn't owned or there's no room left). */
export function parseItemDragPayload(raw: string): { itemId: string } | undefined {
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed?.itemId === 'string' ? parsed : undefined;
    } catch {
        return undefined;
    }
}

export function Money({ amount }: { amount: number }): ReactNode {
    return <span className="money">${amount.toLocaleString('en-US')}</span>;
}

/** A stat's icon plus its three-letter code — the one way a stat ID is ever shown in the UI. */
export function StatAbbr({ stat }: { stat: StatId }): ReactNode {
    return (
        <span className="stat-abbr">
            <img className="stat-abbr__icon" src={`${import.meta.env.BASE_URL}icons/stats/${stat}.png`} alt="" />
            {stat.toUpperCase()}
        </span>
    );
}

/** Up to two letters standing in for an item's icon — nothing in the data has real art per item. */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * An item, standing in as a small monogram tile since nothing in the data has real per-item icons.
 * Used both for the Shop page's "equipped" strip (clickable, to unequip) and a filled slot's compact
 * preview of what its agent carries (not clickable — the pencil is what opens the real page for that).
 */
export function EquipIcon({
    name,
    qty,
    mini,
    onClick,
    title,
}: {
    name: string;
    qty?: number;
    mini?: boolean;
    onClick?: () => void;
    title?: string;
}): ReactNode {
    const className = mini ? 'equip-icon equip-icon--mini' : 'equip-icon';
    const label = title ?? (qty && qty > 1 ? `${name} ×${qty}` : name);
    const content = (
        <>
            <span className="equip-icon__glyph">{initials(name)}</span>
            {qty && qty > 1 ? <span className="equip-icon__qty">×{qty}</span> : null}
        </>
    );

    return onClick ? (
        <button type="button" className={className} onClick={onClick} title={label}>
            {content}
        </button>
    ) : (
        <span className={className} title={label}>
            {content}
        </span>
    );
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

/** Corner layout, clockwise from the top — independent of STAT_IDS's data order. */
const HEX_ORDER: readonly StatId[] = ['int', 'end', 'sth', 'cha', 'pre', 'ast'];
const HEX_ANGLES = HEX_ORDER.map((_, index) => ((-90 + index * 60) * Math.PI) / 180);

/** What each stat governs — shown as the icon's hover tooltip, since the corner carries no text. */
const STAT_EXPLAINER: Record<StatId, string> = {
    ast: 'Assault — firepower and close-quarters combat.',
    end: 'Endurance — health and resilience under fire.',
    sth: 'Stealth — staying unseen and unheard.',
    pre: 'Precision — accuracy, timing, technical finesse.',
    int: 'Intellect — analysis, hacking, planning.',
    cha: 'Charisma — persuasion, deception, social leverage.',
};

function pointAt(cx: number, cy: number, angle: number, radius: number): readonly [number, number] {
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/**
 * The six stats as a hexagon radar — shape reads at a glance, hover a corner icon for what it means.
 *
 * Reads one agent's stats by default. Pass `totals` instead (a per-stat sum, e.g. the whole assigned
 * team) to plot that instead — the same shape either way, just a different source for the numbers.
 * `mini` shrinks it via CSS alone; the SVG's own geometry — and so the hover targets — don't change.
 */
export function StatHexagon({
    agent,
    totals,
    mini,
}: {
    agent?: RuntimeAgent;
    totals?: ReadonlyMap<StatId, number>;
    mini?: boolean;
}): ReactNode {
    const tables = useGame((state) => state.tables);
    const valueOf = (stat: StatId): number =>
        totals ? (totals.get(stat) ?? 0) : agent ? runtimeAgent.effectiveStats(agent).get(stat) : 0;

    const cx = 105;
    const cy = 100;
    const radius = 54;
    const iconRadius = radius + 24;
    const iconSize = 33;

    const ringPolygons = [0.33, 0.66, 1].map((f) =>
        HEX_ANGLES.map((angle) => pointAt(cx, cy, angle, f * radius).join(',')).join(' '),
    );

    const valuePoints = HEX_ORDER.map((stat, index) => {
        const max = tables?.Stat.get(stat)?.maxValue ?? 20;
        const frac = Math.max(0, Math.min(1, max > 0 ? valueOf(stat) / max : 0));
        return pointAt(cx, cy, HEX_ANGLES[index], frac * radius);
    });

    return (
        <svg
            className={mini ? 'stat-hex stat-hex--mini' : 'stat-hex'}
            viewBox="0 0 210 210"
            role="img"
            aria-label={totals ? 'Team stats' : 'Stats'}
        >
            {ringPolygons.map((points, index) => (
                <polygon key={index} points={points} className="stat-hex__ring" />
            ))}
            {HEX_ANGLES.map((angle, index) => {
                const [x, y] = pointAt(cx, cy, angle, radius);
                return <line key={index} x1={cx} y1={cy} x2={x} y2={y} className="stat-hex__axis" />;
            })}
            <polygon points={valuePoints.map((point) => point.join(',')).join(' ')} className="stat-hex__value" />
            {valuePoints.map(([x, y], index) => {
                const stat = HEX_ORDER[index];
                return (
                    <circle key={stat} cx={x} cy={y} r={2.5} className="stat-hex__dot">
                        <title>{`${stat.toUpperCase()}: ${valueOf(stat)}`}</title>
                    </circle>
                );
            })}
            {HEX_ANGLES.map((angle, index) => {
                const stat = HEX_ORDER[index];
                const [ix, iy] = pointAt(cx, cy, angle, iconRadius);
                return (
                    <foreignObject
                        key={stat}
                        x={ix - iconSize / 2}
                        y={iy - iconSize / 2}
                        width={iconSize}
                        height={iconSize}
                    >
                        <img
                            className="stat-hex__icon"
                            src={`${import.meta.env.BASE_URL}icons/stats/${stat}.png`}
                            alt={tables?.Stat.get(stat)?.displayName ?? stat.toUpperCase()}
                            title={STAT_EXPLAINER[stat]}
                        />
                    </foreignObject>
                );
            })}
        </svg>
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
    size = 'md',
    onClick,
    draggable,
    dragFromSlotId,
}: {
    agent: RuntimeAgent;
    selected?: boolean;
    disabled?: boolean;
    size?: 'md' | 'sm';
    onClick?: () => void;
    /** PC-only pick-up-and-drop-on-a-slot, as an alternative to the click-agent-then-click-slot
     *  flow. The character id (plus `dragFromSlotId`, if given) travels as JSON text, which a
     *  slot's onDrop reads back out. */
    draggable?: boolean;
    /** Set when this card is a filled slot's own display, not the roster's — lets the drop target
     *  tell "moved from the roster" apart from "moved from another slot" (the latter is a swap). */
    dragFromSlotId?: string;
}): ReactNode {
    const className = [
        'agent-card',
        size === 'sm' ? 'agent-card--sm' : '',
        selected ? 'agent-card--selected' : '',
        disabled ? 'agent-card--disabled' : '',
    ]
        .filter(Boolean)
        .join(' ');

    const buttonRef = useRef<HTMLButtonElement>(null);
    const showTimerRef = useRef<number>();
    const hideTimerRef = useRef<number>();
    const [anchor, setAnchor] = useState<DOMRect>();

    useEffect(
        () => () => {
            window.clearTimeout(showTimerRef.current);
            window.clearTimeout(hideTimerRef.current);
        },
        [],
    );

    function scheduleShow(): void {
        window.clearTimeout(hideTimerRef.current);
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = window.setTimeout(() => {
            if (buttonRef.current) setAnchor(buttonRef.current.getBoundingClientRect());
        }, 500);
    }

    // A short grace period rather than hiding immediately — the tooltip is a portal, not a DOM
    // child of the card, so the mouse crosses genuinely empty space moving from one to the other.
    // Cancelled by the tooltip's own onMouseEnter if the cursor lands there in time.
    function scheduleHide(): void {
        window.clearTimeout(showTimerRef.current);
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = window.setTimeout(() => setAnchor(undefined), 150);
    }

    function cancelHide(): void {
        window.clearTimeout(hideTimerRef.current);
    }

    function hideNow(): void {
        window.clearTimeout(showTimerRef.current);
        window.clearTimeout(hideTimerRef.current);
        setAnchor(undefined);
    }

    return (
        // display: contents so this wrapper is invisible to the parent's flex/grid layout — the
        // button remains the real layout child. It only exists because a *disabled* <button> (an
        // unpicked-agent card, most of the time) doesn't fire mouse events in Chromium, and the
        // hover-to-preview should work on those too, not just clickable cards.
        <span style={{ display: 'contents' }} onMouseEnter={scheduleShow} onMouseLeave={scheduleHide}>
            <button
                ref={buttonRef}
                type="button"
                className={className}
                onClick={onClick}
                disabled={disabled || (!onClick && !draggable)}
                draggable={draggable}
                onDragStart={
                    draggable
                        ? (event) => {
                              const payload = dragFromSlotId
                                  ? { characterId: agent.characterId, fromSlotId: dragFromSlotId }
                                  : { characterId: agent.characterId };
                              event.dataTransfer.setData('text/plain', JSON.stringify(payload));
                              event.dataTransfer.effectAllowed = 'move';
                          }
                        : undefined
                }
                onDragStartCapture={hideNow}
                style={{ backgroundImage: `url(${import.meta.env.BASE_URL}avatars/${agent.characterId}.png)` }}
            >
                <span className="agent-card__name">{runtimeAgent.displayName(agent)}</span>
            </button>
            {anchor
                ? createPortal(
                      <AgentTooltip agent={agent} anchor={anchor} onMouseEnter={cancelHide} onMouseLeave={scheduleHide} />,
                      document.body,
                  )
                : null}
        </span>
    );
}

/**
 * The "who is this" preview — stats, name, skills — for whichever card is being hovered. A portal
 * into document.body rather than a child of the card: several of the card's real containers (a
 * fixed-height slot, the bottom roster's scroll strip) clip overflow, which would cut this off.
 * Its own onMouseEnter/onMouseLeave (from AgentCard) are what let the cursor move onto the panel —
 * hover a skill row inside it — without the whole thing vanishing first.
 */
function AgentTooltip({
    agent,
    anchor,
    onMouseEnter,
    onMouseLeave,
}: {
    agent: RuntimeAgent;
    anchor: DOMRect;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}): ReactNode {
    const tables = useGame((state) => state.tables);
    const skills = agent.data.baseSkillIds ?? [];

    // Matches the fixed size in CSS (.agent-tooltip) — flips below and clamps sideways for cards
    // near the top or the left/right edge (the Employment grid's top row, in particular).
    const width = 300;
    const height = 170;
    const margin = 8;
    const above = anchor.top >= height + margin + 12;
    const top = above ? anchor.top - margin : anchor.bottom + margin;
    const left = Math.min(
        Math.max(anchor.left + anchor.width / 2, width / 2 + 8),
        window.innerWidth - width / 2 - 8,
    );

    return (
        <div
            className={above ? 'agent-tooltip' : 'agent-tooltip agent-tooltip--below'}
            role="tooltip"
            style={{ top, left }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className="agent-tooltip__hex">
                <StatHexagon agent={agent} />
            </div>
            <div className="agent-tooltip__info">
                <div className="agent-tooltip__name">{runtimeAgent.fullName(agent)}</div>
                <div className="skill-list agent-tooltip__skills">
                    {skills.map((skillId) => (
                        <SkillRow key={skillId} skillId={skillId} skill={tables?.Skill.get(skillId)} />
                    ))}
                </div>
            </div>
        </div>
    );
}

/** One skill inside the agent tooltip — hovering it, after a short delay, opens a second-level
 *  portal tooltip with the skill's own description. Read-only (pointer-events: none), so it needs
 *  no hover-over-it handling of its own the way AgentTooltip does. */
function SkillRow({ skillId, skill }: { skillId: string; skill: SkillData | undefined }): ReactNode {
    const rowRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number>();
    const [anchor, setAnchor] = useState<DOMRect>();

    useEffect(() => () => window.clearTimeout(timerRef.current), []);

    function scheduleShow(): void {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
            if (rowRef.current) setAnchor(rowRef.current.getBoundingClientRect());
        }, 300);
    }

    function hide(): void {
        window.clearTimeout(timerRef.current);
        setAnchor(undefined);
    }

    return (
        <div ref={rowRef} className="skill-row" onMouseEnter={scheduleShow} onMouseLeave={hide}>
            {skill?.displayName ?? skillId}
            {anchor ? createPortal(<SkillDetailTooltip skillId={skillId} skill={skill} anchor={anchor} />, document.body) : null}
        </div>
    );
}

function SkillDetailTooltip({
    skillId,
    skill,
    anchor,
}: {
    skillId: string;
    skill: SkillData | undefined;
    anchor: DOMRect;
}): ReactNode {
    const width = 220;
    const margin = 10;
    const onRight = anchor.right + margin + width <= window.innerWidth;
    const left = onRight ? anchor.right + margin : Math.max(8, anchor.left - margin - width);
    const top = Math.min(anchor.top, window.innerHeight - 130);

    return (
        <div className="skill-tooltip" role="tooltip" style={{ top, left, width }}>
            <div className="skill-tooltip__name">{skill?.displayName ?? skillId}</div>
            {skill?.type ? <div className="skill-tooltip__type">{skill.type}</div> : null}
            <div className="skill-tooltip__desc">{skill?.description || 'No further detail on file.'}</div>
        </div>
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
    hideClose,
}: {
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
    label: string;
    hideClose?: boolean;
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
                {hideClose ? null : (
                    <button type="button" className="icon-btn modal__close" onClick={onClose} aria-label="Close">
                        ✕
                    </button>
                )}
                {children}
            </div>
        </div>
    );
}
