import { useState, type ReactNode } from 'react';
import { SPEED_STEPS } from '../../engine/clock';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import { previewReward, slotCountFor } from '../../engine/missionPreview';
import type { LiveMission } from '../../engine/missionFeed';
import { AgentCard, ConfirmDialog, DifficultyPips, EquipIcon, Money, parseAgentDragPayload, parseItemDragPayload } from '../components/bits';
import type { RuntimeAgent } from '../../engine/runtimeAgent';

/** The focused agent (whichever slot pencil opened Kit mode) first, everyone else in slot order —
 *  a hint at where a drop lands by default, not a restriction on who else can receive one. */
function orderedByFocus(agents: readonly RuntimeAgent[], focusCharacterId: string | undefined): RuntimeAgent[] {
    if (!focusCharacterId) return [...agents];
    const focused = agents.filter((agent) => agent.characterId === focusCharacterId);
    const rest = agents.filter((agent) => agent.characterId !== focusCharacterId);
    return [...focused, ...rest];
}

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
    const tables = useGame((state) => state.tables);
    const openMission = useGame((state) => state.openMission);
    const declineMission = useGame((state) => state.declineMission);
    const overlay = useGame((state) => state.overlay);
    const session = useGame((state) => state.session);
    const pickingAgentId = useGame((state) => state.pickingAgentId);
    const pickAgent = useGame((state) => state.pickAgent);
    const unassignAgent = useGame((state) => state.unassignAgent);
    const assignItem = useGame((state) => state.assignItem);
    const unassignItem = useGame((state) => state.unassignItem);
    const discardCarriedItems = useGame((state) => state.discardCarriedItems);
    const shopCharacterId = useGame((state) => state.shopCharacterId);
    const picking = overlay === 'missionSummary';
    const inventoryMode = overlay === 'shop';

    const [decliningMission, setDecliningMission] = useState<LiveMission>();

    // An agent already filling a slot on this mission isn't free to pick for another — the roster
    // card disappears the moment it's assigned, and comes back the moment it's unassigned.
    const availableRoster = session ? roster.filter((agent) => !session.slotOf(agent.characterId)) : roster;

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
                    {pending.map((mission) => {
                        const reward = tables ? previewReward(tables, mission.data.outcomes?.[0]) : { money: 0, exp: 0 };
                        const slots = tables ? slotCountFor(mission, tables) : { mandatory: 0, total: 0 };
                        const canDecline = mission.data.isDeclinable !== false;

                        return (
                            <div className="mission-row" key={mission.instanceId}>
                                <button
                                    type="button"
                                    className="mission-row__open"
                                    onClick={() => openMission(mission.instanceId)}
                                >
                                    <DifficultyPips level={mission.data.difficultyLevel} />
                                    <span className="mission-row__info">
                                        <span className="mission-row__name">{mission.data.displayName}</span>
                                        <br />
                                        <span className="mission-row__where">
                                            {mission.location?.displayName ?? 'Unknown'} ·{' '}
                                            {mission.data.type ?? 'contract'} · {slots.mandatory}{' '}
                                            agent{slots.mandatory === 1 ? '' : 's'}
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
                                        onClick={() => setDecliningMission(mission)}
                                    >
                                        Decline
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pinned to the bottom of the screen at all times — including while the mission modal
                sits on top of it, so it doubles as that modal's agent picker rather than the modal
                carrying its own copy of the same list. Dropping a slot's own agent card back here
                (fromSlotId set) unassigns them — the QoL mirror of dragging one out to a slot.
                Kit mode repurposes this same strip, same height, as the drop targets for the item
                grid above: one row per assigned teammate, avatar then their carried slots. */}
            {inventoryMode && session ? (
                <div className="roster roster--inventory">
                    {orderedByFocus(session.assignedAgents(), shopCharacterId).map((agent) => {
                        const carried = session.carriedSlots(agent.characterId);
                        const capacity = runtimeAgent.inventorySize(agent);
                        const emptySlots = Math.max(0, capacity - carried.length);

                        return (
                            <div
                                className={
                                    agent.characterId === shopCharacterId ? 'inv-agent inv-agent--focused' : 'inv-agent'
                                }
                                key={agent.characterId}
                            >
                                <div className="inv-agent__row">
                                    <AgentCard agent={agent} />
                                    <div
                                        className="inv-agent__slots"
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            const payload = parseItemDragPayload(event.dataTransfer.getData('text/plain'));
                                            if (payload) assignItem(agent.characterId, payload.itemId, 1);
                                        }}
                                    >
                                        {carried.map(({ itemId, qty }, index) => {
                                            const item = tables?.Item.get(itemId);
                                            const name = item?.displayName ?? itemId;
                                            const maxStack = item?.maxStackCount ?? 0;

                                            return (
                                                <div className="equip-slot" key={`${itemId}-${index}`}>
                                                    <EquipIcon
                                                        name={name}
                                                        qty={qty}
                                                        onRemove={() => unassignItem(agent.characterId, itemId, qty)}
                                                    />
                                                    {maxStack > 1 ? (
                                                        <div className="equip-slot__stepper">
                                                            <button
                                                                type="button"
                                                                className="equip-slot__step"
                                                                onClick={() => unassignItem(agent.characterId, itemId, 1)}
                                                                aria-label={`One fewer ${name}`}
                                                            >
                                                                −
                                                            </button>
                                                            <span className="equip-slot__count">
                                                                {qty}/{maxStack}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className="equip-slot__step"
                                                                disabled={qty >= maxStack}
                                                                onClick={() => assignItem(agent.characterId, itemId, 1)}
                                                                aria-label={`One more ${name}`}
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                        {Array.from({ length: emptySlots }, (_, index) => (
                                            <span
                                                key={`empty-${index}`}
                                                className="equip-icon equip-icon--empty"
                                                aria-hidden="true"
                                            />
                                        ))}
                                    </div>
                                </div>
                                {carried.length > 0 ? (
                                    <div className="inv-agent__actions">
                                        <button
                                            type="button"
                                            className="btn btn--small btn--quiet"
                                            onClick={() => discardCarriedItems(agent.characterId)}
                                            aria-label={`Discard everything ${runtimeAgent.displayName(agent)} is carrying`}
                                        >
                                            🗑 Discard all
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div
                    className="roster"
                    onDragOver={(event) => {
                        if (picking) event.preventDefault();
                    }}
                    onDrop={(event) => {
                        if (!picking) return;
                        event.preventDefault();
                        const payload = parseAgentDragPayload(event.dataTransfer.getData('text/plain'));
                        if (payload?.fromSlotId) unassignAgent(payload.fromSlotId);
                    }}
                >
                    {roster.length === 0 ? (
                        <span className="meta">No agents employed.</span>
                    ) : availableRoster.length === 0 ? (
                        <span className="meta dim">Everyone's already assigned.</span>
                    ) : (
                        availableRoster.map((agent) => (
                            <AgentCard
                                key={agent.characterId}
                                agent={agent}
                                selected={picking && agent.characterId === pickingAgentId}
                                disabled={picking && !runtimeAgent.isAvailable(agent)}
                                onClick={picking ? () => pickAgent(agent.characterId) : undefined}
                                draggable={picking && runtimeAgent.isAvailable(agent)}
                            />
                        ))
                    )}
                </div>
            )}

            <ConfirmDialog
                open={Boolean(decliningMission)}
                title="Decline this mission?"
                message="The client won't be asked twice. This contract leaves the board for good."
                confirmLabel="Decline"
                danger
                onConfirm={() => {
                    if (decliningMission) declineMission(decliningMission.instanceId);
                    setDecliningMission(undefined);
                }}
                onCancel={() => setDecliningMission(undefined)}
            />
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
