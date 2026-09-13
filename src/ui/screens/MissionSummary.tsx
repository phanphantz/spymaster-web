import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import type { RuntimeAgent } from '../../engine/runtimeAgent';
import {
    AgentBackdrop,
    AgentCard,
    ConfirmDialog,
    DifficultyPips,
    Emphasized,
    EquipIcon,
    ExpGauge,
    HoldButton,
    Modal,
    PageTabs,
    StatAbbr,
    StatHexagon,
    parseAgentDragPayload,
    useEscapeToClose,
} from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { GameTables, StatId } from '../../engine/types';
import type { LoadoutSession } from '../../engine/loadout';
import type { LiveMission } from '../../engine/missionFeed';
import { previewReward, previewLikelihood } from '../../engine/missionPreview';
import { ShopScreen } from './ShopScreen';

/** Per-stat sum across a set of agents — the team's combined hexagon reads this, not any one agent's. */
function combinedStats(agents: readonly RuntimeAgent[]): Map<StatId, number> {
    const totals = new Map<StatId, number>();
    for (const stat of STAT_IDS) {
        totals.set(stat, agents.reduce((sum, agent) => sum + runtimeAgent.effectiveStats(agent).get(stat), 0));
    }
    return totals;
}

const LIKELIHOOD_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/**
 * Every duration in the reveal, in ms — the single source for both the stagger math below and the
 * keyframes in app.css, which read these back as the `--intro-*-ms` custom properties set on the
 * modal (see `introVars`), so the two can't drift apart.
 */
const INTRO_MS = {
    /** Left column in, stats rail in, team grid up — deliberately quick. */
    slide: 260,
    /** Location, rewards, placeholders, the modal corner, the "Got it" button. */
    fade: 200,
    /** One briefing line fading in — the one beat paced for reading rather than for speed. */
    line: 1400,
    /** From one briefing line starting to the next starting. */
    lineStep: 1120,
    /** The briefing's move from centered to its top-left spot. */
    collapse: 550,
} as const;

const introVars = {
    '--intro-slide-ms': `${INTRO_MS.slide}ms`,
    '--intro-fade-ms': `${INTRO_MS.fade}ms`,
    '--intro-line-ms': `${INTRO_MS.line}ms`,
    '--intro-collapse-ms': `${INTRO_MS.collapse}ms`,
} as CSSProperties;

/**
 * The reveal has no fixed length overall — it splits at "Got it", the one beat the player actually
 * paces themselves: everything up to there runs on a timer (below), then it waits, however long
 * that takes, for the click before continuing.
 */
interface MissionIntroPreAck {
    /** The location block's fade — starts the instant the left column lands. */
    location: number;
    briefName: number;
    briefRow: number;
    /** Unset when the mission has no hint to show — nothing to delay. */
    briefHint?: number;
    /** Unset when the mission has no description to show. */
    briefDescription?: number;
    /** When the last briefing line's own fade-in finishes — the "Got it" button appears then, not
     *  before, so it never sits next to text still stuck at opacity 0. */
    linesDoneMs: number;
}

/**
 * When each stage before "Got it" starts, in ms from the modal mounting — the one place that owns
 * *when*; app.css's "Mission onboarding reveal" rules own the *how* (the keyframes and durations),
 * applied via the `animationDelay` this computes. Compresses on its own when a mission authors no
 * hint or description.
 */
function missionIntroPreAck(mission: LiveMission): MissionIntroPreAck {
    // Chained off the left column's own slide duration, then the location's fade, so each beat is
    // fully landed before the next starts rather than landing in order by coincidence.
    const location = INTRO_MS.slide;
    const BRIEF_BASE = location + INTRO_MS.fade + 150;

    let line = 0;
    const briefName = BRIEF_BASE + INTRO_MS.lineStep * line++;
    const briefRow = BRIEF_BASE + INTRO_MS.lineStep * line++;
    const briefHint = mission.data.hint ? BRIEF_BASE + INTRO_MS.lineStep * line++ : undefined;
    const briefDescription = mission.data.description ? BRIEF_BASE + INTRO_MS.lineStep * line++ : undefined;
    const linesDoneMs = (briefDescription ?? briefHint ?? briefRow) + INTRO_MS.line;

    return { location, briefName, briefRow, briefHint, briefDescription, linesDoneMs };
}

interface MissionIntroPostAck {
    /** The stats rail's slide-in — starts the instant the briefing lands top-left. */
    rightSlideDelay: number;
    reward: number;
    /** The team slot grid's slide-up, alongside the stats rail's "assign agents" placeholder and
     *  the modal corner's Cost/Success/Confirm fixture. */
    team: number;
    /** How long to hold the reveal on screen, after "Got it", before it settles on its own. */
    totalMs: number;
}

/**
 * Everything from "Got it" onward, all relative to that click rather than to mount — there's no
 * fixed moment for it to count from until the player supplies one. The briefing's own move to its
 * final spot is CSS-only (`.mission-brief--go`, delay 0): it starts the instant the click adds that
 * class, same as every other delay 0 here.
 */
function missionIntroPostAck(): MissionIntroPostAck {
    // Back-to-back, no idle gaps: each beat starts as the previous one lands.
    const rightSlideDelay = INTRO_MS.collapse;
    const reward = rightSlideDelay + INTRO_MS.slide;
    const team = reward + INTRO_MS.fade;
    const totalMs = team + INTRO_MS.slide + 100;

    return { rightSlideDelay, reward, team, totalMs };
}

const POST_ACK = missionIntroPostAck();

/**
 * Drives the mission-open reveal: whether to play it at all (a mission only ever gets one, the
 * first time its modal opens — see `seenMissionIntros`), and its checkpoints — the briefing lines
 * finishing (on their own, or fast-forwarded by a tap), the "Got it" acknowledgement the player
 * paces themselves, and the settle once the post-ack timeline runs out. There is no skipping the
 * whole thing: a tap only ever fast-forwards the text reveal.
 *
 * `animate` is decided once, from a lazy initializer, so a later store update (the very
 * `markMissionIntroSeen` call this same hook makes) can't flip it mid-playthrough — only a fresh
 * mount (a genuinely different mission) re-evaluates it.
 */
function useMissionIntro(mission: LiveMission | undefined): {
    introActive: boolean;
    /** Every briefing line is fully shown and "Got it" is up (or already pressed). */
    linesReady: boolean;
    /** The lines got there via a tap rather than their own timers — their animations have to be
     *  snapped to the end, not left to finish. */
    linesSkipped: boolean;
    acknowledged: boolean;
    preAck: MissionIntroPreAck | undefined;
    acknowledge: () => void;
    skipLines: () => void;
} {
    const seenMissionIntros = useGame((state) => state.seenMissionIntros);
    const markMissionIntroSeen = useGame((state) => state.markMissionIntroSeen);
    const instanceId = mission?.instanceId;

    const [animate] = useState(() => Boolean(instanceId && !seenMissionIntros.has(instanceId)));
    const [linesReady, setLinesReady] = useState(false);
    const [linesSkipped, setLinesSkipped] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);
    const [finished, setFinished] = useState(false);
    const preAck = mission ? missionIntroPreAck(mission) : undefined;

    useEffect(() => {
        if (!instanceId || !animate || !preAck) return;
        markMissionIntroSeen(instanceId);
        const timer = window.setTimeout(() => setLinesReady(true), preAck.linesDoneMs);
        return () => window.clearTimeout(timer);
        // Deliberately keyed on the mission alone: the delays a re-render might recompute from
        // haven't changed for a mission already mid-reveal, and re-arming this timer would just
        // push its natural completion further out for no reason.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instanceId]);

    // The post-ack timeline only starts counting once the player has actually pressed "Got it" —
    // there is no mount-relative fallback, the pre-ack half waits for that click indefinitely.
    useEffect(() => {
        if (!acknowledged) return;
        const timer = window.setTimeout(() => setFinished(true), POST_ACK.totalMs);
        return () => window.clearTimeout(timer);
    }, [acknowledged]);

    return {
        introActive: animate && !finished,
        linesReady,
        linesSkipped,
        acknowledged,
        preAck,
        acknowledge: () => setAcknowledged(true),
        skipLines: () => {
            setLinesSkipped(true);
            setLinesReady(true);
        },
    };
}

/**
 * The planning-status chip pinned in the modal's own top-right corner (`Modal`'s `corner` prop) —
 * one fixture shared by the Mission page and the Kit page, since both are just `children` swapped
 * inside the same Modal instance. Reads live off the session on every render, so dragging an item
 * in Kit mode updates it immediately, with no separate refresh path to keep in sync.
 *
 * Success is Low/Medium/High, not a percentage — `missionOutcomeResolver` computes none, by design
 * (see its own docs) — this just relabels whichever Outcome tier the current Loadout would clear
 * right now. Cost is the total already charged for what is presently assigned, i.e. what cancelling
 * the whole Loadout would refund.
 */
function PlanningStatus({ session }: { session: LoadoutSession }): ReactNode {
    const likelihood = previewLikelihood(session);
    const cost = session.totalPreparationCost();

    return (
        <div className="planning-status">
            <span className="planning-status__item">
                <span className="planning-status__label">Cost</span>
                <span className="planning-status__value planning-status__value--cost">
                    ${cost.toLocaleString('en-US')}
                </span>
            </span>
            <span className="planning-status__item">
                <span className="planning-status__label">Success</span>
                <span className={`planning-status__value planning-status__value--${likelihood ?? 'none'}`}>
                    {likelihood ? LIKELIHOOD_LABEL[likelihood] : '—'}
                </span>
            </span>
        </div>
    );
}

/**
 * The modal's whole top-right fixture: Cost, Success, then Confirm — grouped so deploying is one
 * press-and-hold away from the same status a player is reading to decide whether to. Pinned to the
 * modal frame itself (not `.summary__stats`), it stays reachable from the Kit page too — there's no
 * longer a separate Confirm button that only existed on the Mission page.
 */
function MissionCorner({
    session,
    onDeploy,
    introClassName,
    introDelayMs,
}: {
    session: LoadoutSession;
    onDeploy: () => void;
    /** Set only while the mission-open reveal is playing — fades this in on its own turn (once the
     *  player has pressed "Got it") instead of showing Cost/Success/Confirm before there's even a
     *  team to evaluate. See `.modal--intro` in app.css, which is what actually scopes the fade
     *  (this corner sits outside `.summary`, in the Modal's own chrome, so `.summary--intro`'s
     *  descendant rules can't reach it). */
    introClassName?: string;
    introDelayMs?: number;
}): ReactNode {
    return (
        <div
            className={introClassName ?? 'mission-corner'}
            style={introDelayMs !== undefined ? { animationDelay: `${introDelayMs}ms` } : undefined}
        >
            <PlanningStatus session={session} />
            <HoldButton
                className="btn--primary mission-corner__confirm"
                label="Confirm"
                disabled={!session.canConfirm}
                onComplete={onDeploy}
            />
        </div>
    );
}

/**
 * The Mission UI: read the contract, build the team, then deploy or decline — one page, not a
 * tab switcher. Follows `UIMissionSummary` in `UI_DESIGN_SYSTEM.md` §5.3 for the briefing half —
 * photo and location on the left, the briefing and the team in the middle, split by a steel rule
 * carrying a notification dot. The team's combined stats — hexagon and gauges — live in their own
 * rail on the far right, always visible instead of swapped in over the location block, since
 * they're what the player is actually optimizing while they work the slot grid next to them.
 *
 * Assignment happens in the same modal rather than handing off to a separate Loadout page: the
 * Loadout session is stood up the moment the mission opens, and the slot grid is that session's
 * real, interactive state, not a preview of it.
 *
 * It shows the hint, which is authored and may be deliberately oblique, and what the job demands of
 * a team. It does **not** show a success chance, because none is computed — the result is whichever
 * authored Outcome tier the loadout clears.
 */
export function MissionSummary(): ReactNode {
    useGame((state) => state.version);

    const tables = useGame((state) => state.tables);
    const session = useGame((state) => state.session);
    const close = useGame((state) => state.closeOverlay);
    const deploy = useGame((state) => state.deployMission);
    const decline = useGame((state) => state.declineMission);
    const unassignAgent = useGame((state) => state.unassignAgent);
    const pickingAgentId = useGame((state) => state.pickingAgentId);
    const pickingSlotId = useGame((state) => state.pickingSlotId);
    const pickSlot = useGame((state) => state.pickSlot);
    const placeAgent = useGame((state) => state.placeAgent);
    const pendingSwap = useGame((state) => state.pendingSwap);
    const resolveSwap = useGame((state) => state.resolveSwap);
    const cancelSwap = useGame((state) => state.cancelSwap);
    const failure = useGame((state) => state.assignmentFailure);
    const openShop = useGame((state) => state.openShop);
    const overlay = useGame((state) => state.overlay);
    const closeShop = useGame((state) => state.closeShop);

    const [confirmingDecline, setConfirmingDecline] = useState(false);
    const [confirmingClose, setConfirmingClose] = useState(false);
    const { introActive, linesReady, linesSkipped, acknowledged, preAck, acknowledge, skipLines } = useMissionIntro(
        session?.mission,
    );

    if (!session || !tables) return null;

    const inventoryMode = overlay === 'shop';
    const mission = session.mission;
    const canDecline = mission.data.isDeclinable !== false;
    const hasAssignments = session.assignments.size > 0;
    const assigned = session.assignedAgents();

    const keywordTerms = [
        mission.location?.displayName,
        mission.data.type,
        ...session.slots.flatMap((slot) => [
            ...(slot.requirement?.tags ?? []),
            ...(slot.requirement?.excludedTags ?? []),
        ]),
    ].filter((term): term is string => Boolean(term));

    // Playing while the mission page itself is showing — Kit mode has nothing to reveal, but the
    // reveal keeps running underneath so switching back to Agent doesn't restart it.
    const revealing = introActive && !inventoryMode;
    const delayMs = (ms: number | undefined): { animationDelay: string } | undefined =>
        revealing ? { animationDelay: `${ms ?? 0}ms` } : undefined;
    // Everything gated on "Got it": present (and, while reading, hidden) throughout the reveal, but
    // only animates in once the player has actually pressed the button — see the matching `--go`
    // rule for each of these classes in app.css.
    const introCls = (base: string): string => (revealing ? `${base}${acknowledged ? ` ${base}--go` : ''}` : base);

    return (
        <Modal
            onClose={() => (inventoryMode ? closeShop() : hasAssignments ? setConfirmingClose(true) : close())}
            wide
            kit={inventoryMode}
            label={inventoryMode ? 'Kit' : (mission.data.displayName ?? 'Mission')}
            hideClose
            introActive={revealing}
            // Always set, not just while revealing: the divider lines' fade-in (see `.modal--wide::before`)
            // reads its duration the moment the reveal ends and the intro class comes off.
            style={introVars}
            corner={
                <MissionCorner
                    session={session}
                    onDeploy={deploy}
                    introClassName={revealing ? introCls('mission-corner') : undefined}
                    introDelayMs={revealing ? POST_ACK.team : undefined}
                />
            }
            topLeft={
                <button
                    type="button"
                    className="btn btn--quiet btn--small"
                    onClick={() => (hasAssignments ? setConfirmingClose(true) : close())}
                >
                    Close
                </button>
            }
        >
            <div className="modal__body">
                {inventoryMode ? (
                    <ShopScreen
                        session={session}
                        tables={tables}
                        onSelectTab={(tab) => (tab === 'agent' ? closeShop() : undefined)}
                    />
                ) : (
                <div
                    className={
                        revealing ? `summary summary--intro${linesSkipped ? ' summary--lines-shown' : ''}` : 'summary'
                    }
                >
                    <div className="summary__left">
                        <div className="summary__photo">NO IMAGE</div>
                        <div className="summary__lower-anchor">
                            <hr className="summary__dashrule" />
                            <LocationBlock mission={mission} introDelayMs={revealing ? preAck?.location : undefined} />
                        </div>
                    </div>

                    <div className="summary__divider">
                        <span className="summary__dot" aria-hidden="true" />
                    </div>

                    <div className="summary__right">
                        <button
                            type="button"
                            className="icon-btn summary__decline"
                            onClick={() => setConfirmingDecline(true)}
                            disabled={!canDecline}
                            aria-label="Decline mission"
                            title={canDecline ? 'Decline mission' : 'This client does not take no for an answer'}
                            style={delayMs(POST_ACK.team)}
                        >
                            🗑
                        </button>
                        <div className="summary__scroll">
                            {/* Centered over the column while the name/row/hint/description fade in one at a
                                time; "Got it" appears once the last of those lines has, and only that click —
                                not a timer — starts this group moving and scaling down into its normal
                                top-left flow spot. See `.mission-brief` in app.css for how the same base rule
                                serves as both the pre-click resting state and (once `.summary--intro` comes
                                off entirely) the plain, un-animated layout. */}
                            <div className={introCls('mission-brief')}>
                                <h2 className="summary__name" style={delayMs(preAck?.briefName)}>
                                    {mission.data.displayName}
                                </h2>

                                <div className="summary__row" style={delayMs(preAck?.briefRow)}>
                                    <span className="chip">{mission.data.type ?? 'contract'}</span>
                                    <DifficultyPips level={mission.data.difficultyLevel} />
                                </div>

                                {mission.data.hint ? (
                                    <p className="hint" style={delayMs(preAck?.briefHint)}>
                                        <Emphasized text={mission.data.hint} terms={keywordTerms} />
                                    </p>
                                ) : null}

                                {mission.data.description ? (
                                    <p className="summary__body" style={delayMs(preAck?.briefDescription)}>
                                        <Emphasized text={mission.data.description} terms={keywordTerms} />
                                    </p>
                                ) : null}

                                {revealing && linesReady && !acknowledged ? (
                                    <button
                                        type="button"
                                        className="btn btn--primary btn--small mission-intro__acknowledge"
                                        onClick={acknowledge}
                                    >
                                        Got it
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {/* Pinned outside the scroll region, not squeezed by it — a long hint or
                            description scrolls in the space above, but the slot grid (up to 4 slots,
                            2 rows at their fixed height) always has the room it needs and is never
                            what gets clipped or pushed into a scrollbar. */}
                        <MissionTeam
                            session={session}
                            tables={tables}
                            pickingAgentId={pickingAgentId}
                            pickingSlotId={pickingSlotId}
                            onPickSlot={pickSlot}
                            onDropAgent={placeAgent}
                            onUnassign={unassignAgent}
                            onEdit={openShop}
                            failure={failure}
                            introClassName={revealing ? introCls('summary__team') : undefined}
                            introDelayMs={revealing ? POST_ACK.team : undefined}
                        />
                    </div>

                    <div className={introCls('summary__stats')} style={delayMs(POST_ACK.rightSlideDelay)}>
                        <RewardSquares
                            mission={mission}
                            tables={tables}
                            introClassName={revealing ? introCls('reward-box') : undefined}
                            introDelayMs={revealing ? POST_ACK.reward : undefined}
                        />
                        {assigned.length > 0 ? (
                            <div className="summary__photo summary__photo--stats">
                                <StatHexagon totals={combinedStats(assigned)} />
                            </div>
                        ) : (
                            <p className={introCls('summary__stats-empty')} style={delayMs(POST_ACK.team)}>
                                Assign agents to see stat summary
                            </p>
                        )}
                        <div className="summary__lower-anchor">
                            <hr className="summary__dashrule" />
                            {assigned.length > 0 ? <StatGaugeList agents={assigned} tables={tables} /> : null}
                            <div className="summary__actions summary__actions--right">
                                <PageTabs active="agent" onSelect={(tab) => (tab === 'inventory' ? openShop('') : undefined)} />
                            </div>
                        </div>
                    </div>

                    {revealing ? (
                        <>
                            {/* Blocks clicks on not-yet-revealed controls for the whole reveal, but only
                                skips anything while the briefing text is still appearing — and then only
                                to the "Got it" moment, never past it. */}
                            <div
                                className={
                                    linesReady ? 'mission-intro__catcher' : 'mission-intro__catcher mission-intro__catcher--skip'
                                }
                                onClick={linesReady ? undefined : skipLines}
                                role="presentation"
                            />
                            {linesReady ? null : <span className="mission-intro__skip-hint" aria-hidden="true">❯</span>}
                        </>
                    ) : null}
                </div>
                )}
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

            <ConfirmDialog
                open={confirmingClose}
                title="Close this loadout?"
                message="Every assigned agent will be pulled off this job and anything they're carrying is refunded. Nothing is lost — but you'll have to build the team again."
                confirmLabel="Close"
                danger
                onConfirm={() => {
                    setConfirmingClose(false);
                    close();
                }}
                onCancel={() => setConfirmingClose(false)}
            />

            <SwapDialog
                pendingSwap={pendingSwap}
                session={session}
                onSwapAgents={() => resolveSwap('agents')}
                onSwapItems={() => resolveSwap('items')}
                onSwapBoth={() => resolveSwap('both')}
                onCancel={cancelSwap}
            />
        </Modal>
    );
}

/**
 * Dragging (or clicking) one occupied slot's agent onto another pauses here rather than picking a
 * default — trade just who stands where, just their kits, or both together (each agent leaving with
 * their own kit, as if they'd simply swapped places).
 */
function SwapDialog({
    pendingSwap,
    session,
    onSwapAgents,
    onSwapItems,
    onSwapBoth,
    onCancel,
}: {
    pendingSwap: { slotA: string; slotB: string } | undefined;
    session: LoadoutSession;
    onSwapAgents: () => void;
    onSwapItems: () => void;
    onSwapBoth: () => void;
    onCancel: () => void;
}): ReactNode {
    useEscapeToClose(onCancel, Boolean(pendingSwap));

    if (!pendingSwap) return null;

    const agentA = session.agentIn(pendingSwap.slotA);
    const agentB = session.agentIn(pendingSwap.slotB);
    if (!agentA || !agentB) return null;

    return (
        <div className="backdrop" onClick={onCancel} role="presentation">
            <div
                className="confirm"
                role="alertdialog"
                aria-modal="true"
                aria-label="Swap slots"
                onClick={(event) => event.stopPropagation()}
            >
                <button type="button" className="icon-btn confirm__close" onClick={onCancel} aria-label="Cancel">
                    ✕
                </button>
                <h3 className="confirm__title">
                    Swap {runtimeAgent.displayName(agentA)} and {runtimeAgent.displayName(agentB)}?
                </h3>
                <p className="confirm__body">Trade who's in which slot, what they're carrying, or both.</p>
                <div className="confirm__actions confirm__actions--stack">
                    <button type="button" className="btn btn--quiet" onClick={onSwapAgents}>
                        Swap Agents
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={onSwapItems}>
                        Swap Items
                    </button>
                    <button type="button" className="btn btn--primary" onClick={onSwapBoth}>
                        Swap Both
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * The team's combined stats as horizontal gauges — icon + code on the left, a fixed-width bar, the
 * total on the right. Sits under the hexagon in the always-visible right rail: the hexagon above is
 * the shape, this is the same numbers read as a bar per stat.
 */
function StatGaugeList({ agents, tables }: { agents: readonly RuntimeAgent[]; tables: GameTables }): ReactNode {
    return (
        <div className="stat-gauges">
            {STAT_IDS.map((stat) => {
                const total = agents.reduce((sum, agent) => sum + runtimeAgent.effectiveStats(agent).get(stat), 0);
                // Fixed to one agent's max, not the team's — a second agent should visibly push the
                // bar further, not just hold the same ratio the cap grew to match.
                const cap = tables.Stat.get(stat)?.maxValue ?? 20;
                const ratio = cap > 0 ? Math.min(1, total / cap) : 0;

                return (
                    <div className="stat-gauge" key={stat}>
                        <span className="stat-gauge__label">
                            <StatAbbr stat={stat} />
                        </span>
                        <span className="stat-gauge__track">
                            <span className="stat-gauge__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
                        </span>
                        <span className="stat-gauge__value">{total}</span>
                    </div>
                );
            })}
        </div>
    );
}

/** Payment and exp, as a small square item list at the head of the stats rail — above the hexagon,
 *  which centers in whatever room that leaves above the gauges. */
function RewardSquares({
    mission,
    tables,
    introClassName,
    introDelayMs,
}: {
    mission: LiveMission;
    tables: GameTables;
    /** Set only while the mission-open reveal is playing — see `.summary--intro .reward-box` in
     *  app.css, which is what actually fades this in (once the player has pressed "Got it"); this
     *  just times it. */
    introClassName?: string;
    introDelayMs?: number;
}): ReactNode {
    const reward = previewReward(tables, mission.data.outcomes?.[0]);

    return (
        <div
            className={introClassName ?? 'reward-box'}
            style={introDelayMs !== undefined ? { animationDelay: `${introDelayMs}ms` } : undefined}
        >
            <span className="reward-box__label">Rewards</span>
            <div className="reward-squares">
                <div className="reward-square">
                    <span className="reward-square__icon" aria-hidden="true">💰</span>
                    <span className="reward-square__value">
                        {reward.money ? `$${reward.money.toLocaleString('en-US')}` : '—'}
                    </span>
                </div>
                <div className="reward-square">
                    <span className="reward-square__icon" aria-hidden="true">⭐</span>
                    <span className="reward-square__value">{reward.exp || '—'}</span>
                </div>
            </div>
        </div>
    );
}

/** Location name, address and coordinates, sitting under the photo's fade.
 *  The More/Less disclosure (type, size, state) is hidden for now — hidden, not removed, since the
 *  fields it read are still authored and this is the one place they'd surface. */
function LocationBlock({
    mission,
    introDelayMs,
}: {
    mission: LiveMission;
    /** Set only while the mission-open reveal is playing — see `.summary--intro .summary__location`
     *  in app.css, which is what actually fades this in (right after the left column lands); this
     *  just times it. */
    introDelayMs?: number;
}): ReactNode {
    const location = mission.location;

    return (
        <div
            className="summary__location"
            style={introDelayMs !== undefined ? { animationDelay: `${introDelayMs}ms` } : undefined}
        >
            <span className="summary__location-name">{location?.displayName ?? 'Unknown'}</span>
            <span className="summary__location-detail">
                {location?.address ?? titleCase(location?.country) ?? 'Location withheld'}
            </span>
            <span className="summary__location-detail">
                {formatCoordinate(location?.latitude, 'N', 'S')}{' '}
                {formatCoordinate(location?.longitude, 'E', 'W')}
            </span>
        </div>
    );
}

/**
 * The team's slot grid — pinned to the floor of the middle column, outside the briefing's scroll
 * area, so a long hint or description never squeezes it. Up to 4 slots (2 rows at their fixed
 * height) always has the room it needs; the briefing scrolls instead.
 *
 * The real, interactive Loadout — pick an agent from the roster strip below the modal, then tap a
 * slot, or tap an empty slot first and pick the agent after; either order lands the same placement.
 * An occupied slot clears with the subtle "−" pinned to its corner — same convention as a carried
 * item's own corner remove — and its role/optional label disappears once filled, handing that room
 * to the card itself. What that agent carries lives on its own page, opened by tapping the kit
 * preview floating above the slot — the slot itself has no room for a kit list.
 */
function MissionTeam({
    session,
    tables,
    pickingAgentId,
    pickingSlotId,
    onPickSlot,
    onDropAgent,
    onUnassign,
    onEdit,
    failure,
    introClassName,
    introDelayMs,
}: {
    session: LoadoutSession;
    tables: GameTables;
    pickingAgentId: string | undefined;
    pickingSlotId: string | undefined;
    onPickSlot: (slotId: string) => void;
    onDropAgent: (slotId: string, characterId: string, fromSlotId?: string) => void;
    onUnassign: (slotId: string) => void;
    onEdit: (characterId: string) => void;
    failure: string;
    /** Set only while the mission-open reveal is playing — see `.summary--intro .summary__team` in
     *  app.css, which is what actually slides this up (once the player has pressed "Got it"); this
     *  just times it. */
    introClassName?: string;
    introDelayMs?: number;
}): ReactNode {
    return (
        <div
            className={introClassName ?? 'summary__team'}
            style={introDelayMs !== undefined ? { animationDelay: `${introDelayMs}ms` } : undefined}
        >
            <div className="slot-grid">
                {session.slots.map((slot) => {
                        const occupant = session.agentIn(slot.slotId);
                        const isTarget = slot.slotId === pickingSlotId;
                        // A picked agent (from a click, not mid-drag) could land here and bump someone —
                        // hinted so the slot doesn't just look like a dead end while something is picked.
                        const isReplaceable = Boolean(
                            occupant && pickingAgentId && occupant.characterId !== pickingAgentId,
                        );
                        const className = [
                            'slot',
                            occupant ? 'slot--filled' : '',
                            !occupant && slot.isMandatory ? 'slot--needed' : '',
                            isTarget ? 'slot--picking' : '',
                            isReplaceable ? 'slot--replaceable' : '',
                        ]
                            .filter(Boolean)
                            .join(' ');

                        const carried = occupant ? session.carriedSlots(occupant.characterId) : [];
                        const capacity = occupant ? runtimeAgent.inventorySize(occupant) : 0;
                        const emptySlots = Math.max(0, capacity - carried.length);

                        return (
                            <div className="slot-wrap" key={slot.slotId}>
                                {occupant ? <AgentBackdrop agent={occupant} /> : null}

                                {occupant && capacity > 0 ? (
                                    <button
                                        type="button"
                                        className="slot__items-float"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onEdit(occupant.characterId);
                                        }}
                                        aria-label={`Edit ${runtimeAgent.displayName(occupant)}'s kit`}
                                        title="Edit kit"
                                    >
                                        {carried.map(({ itemId, qty }, index) => {
                                            const name = tables.Item.get(itemId)?.displayName ?? itemId;
                                            return <EquipIcon key={`${itemId}-${index}`} name={name} qty={qty} mini />;
                                        })}
                                        {Array.from({ length: emptySlots }, (_, index) => (
                                            <span
                                                key={`empty-${index}`}
                                                className="equip-icon equip-icon--mini equip-icon--empty"
                                                aria-hidden="true"
                                            />
                                        ))}
                                    </button>
                                ) : null}

                                {/* Hangs off the slot's own corner, outside its overflow: hidden — same
                                    convention as the float above, and as a carried item's own corner
                                    remove — rather than sitting inset inside the card it's clearing. */}
                                {occupant ? (
                                    <button
                                        type="button"
                                        className="slot__remove"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onUnassign(slot.slotId);
                                        }}
                                        aria-label={`Remove ${runtimeAgent.displayName(occupant)}`}
                                    >
                                        −
                                    </button>
                                ) : null}

                                <div
                                    className={className}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const raw = event.dataTransfer.getData('text/plain');
                                        if (!raw) return;
                                        const payload = parseAgentDragPayload(raw);
                                        if (payload) onDropAgent(slot.slotId, payload.characterId, payload.fromSlotId);
                                    }}
                                >
                                    {/* Only an empty slot needs to say what it wants — once it's filled, the
                                        agent card itself is the answer, and hiding this row hands its
                                        space to the card instead. */}
                                    {occupant ? null : (
                                        <div className="slot__head">
                                            <span className="micro">
                                                {slot.slotId.replace(/^slot_/, '')}
                                                {slot.isMandatory ? '' : ' · optional'}
                                            </span>
                                        </div>
                                    )}

                                    {occupant ? (
                                        <div
                                            className="slot__filled"
                                            onClick={() => onPickSlot(slot.slotId)}
                                            role={pickingAgentId ? 'button' : undefined}
                                        >
                                            <div className="slot__filled-main">
                                                <AgentCard agent={occupant} size="sm" draggable dragFromSlotId={slot.slotId} />
                                                <div className="slot__hex-col">
                                                    <StatHexagon agent={occupant} mini />
                                                    <div className="slot__hex-badges">
                                                        <span className="vital-badge" title="Full HP">
                                                            <span aria-hidden="true">❤</span>{' '}
                                                            {runtimeAgent.maxHealth(occupant)}
                                                        </span>
                                                        <span className="vital-badge" title="Inventory slots">
                                                            <span aria-hidden="true">🎒</span>{' '}
                                                            {runtimeAgent.inventorySize(occupant)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="slot__vitals">
                                                <ExpGauge agent={occupant} compact />
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            className="slot__empty"
                                            aria-pressed={isTarget}
                                            onClick={() => onPickSlot(slot.slotId)}
                                        >
                                            {pickingAgentId
                                                ? 'Tap to assign'
                                                : isTarget
                                                  ? 'Pick an agent below'
                                                  : 'Select an agent, drag one, or tap here first'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

            {failure ? <div className="meta danger">{failure}</div> : null}
        </div>
    );
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
