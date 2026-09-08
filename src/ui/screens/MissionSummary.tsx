import { useMemo, useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import type { RuntimeAgent } from '../../engine/runtimeAgent';
import { describeReason } from '../../engine/slotRequirementEvaluator';
import { describePurchaseFailure } from '../../engine/shop';
import { AgentCard, ConfirmDialog, DifficultyPips, Emphasized, Modal } from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { GameTables, ItemData } from '../../engine/types';
import type { LoadoutSession } from '../../engine/loadout';
import type { LiveMission } from '../../engine/missionFeed';

/**
 * The Mission UI: read the contract, build the team, then deploy or decline.
 *
 * Follows `UIMissionSummary` in `UI_DESIGN_SYSTEM.md` §5.3 for the briefing half — photo and
 * location on the left, the briefing on the right, split by a steel rule carrying a notification
 * dot. Assignment happens in the same modal rather than handing off to a separate Loadout page: the
 * Loadout session is stood up the moment the mission opens, and the Assignment tab is that session's
 * real, interactive slot grid, not a preview of it.
 *
 * It shows the hint, which is authored and may be deliberately oblique, and what the job demands of
 * a team. It does **not** show a success chance, because none is computed — the result is whichever
 * authored Outcome tier the loadout clears.
 */
export function MissionSummary(): ReactNode {
    useGame((state) => state.version);

    const tables = useGame((state) => state.tables);
    const session = useGame((state) => state.session);
    const roster = useGame((state) => state.roster);
    const close = useGame((state) => state.closeOverlay);
    const decline = useGame((state) => state.declineMission);
    const deploy = useGame((state) => state.deployMission);
    const assignAgent = useGame((state) => state.assignAgent);
    const unassignAgent = useGame((state) => state.unassignAgent);

    const [tab, setTab] = useState<'details' | 'assignment'>('details');
    const [confirmingDecline, setConfirmingDecline] = useState(false);
    const [pickingAgentId, setPickingAgentId] = useState<string>();
    const [failure, setFailure] = useState('');

    if (!session || !tables) return null;

    const mission = session.mission;
    const canDecline = mission.data.isDeclinable !== false;

    const keywordTerms = [
        mission.location?.displayName,
        mission.data.type,
        ...session.slots.flatMap((slot) => [
            ...(slot.requirement?.tags ?? []),
            ...(slot.requirement?.excludedTags ?? []),
        ]),
    ].filter((term): term is string => Boolean(term));

    /** Places whichever agent is selected in the roster strip into this slot, or explains why not. */
    function placeInSlot(slotId: string): void {
        if (!session || !pickingAgentId) return;

        const candidate = session
            .candidatesFor(slotId)
            .find((entry) => entry.agent.characterId === pickingAgentId);
        if (!candidate) return;

        if (!candidate.isEligible) {
            setFailure(
                candidate.reasons.length
                    ? describeReason(candidate.reasons[0])
                    : `${runtimeAgent.displayName(candidate.agent)} cannot take this slot`,
            );
            return;
        }

        setFailure('');
        assignAgent(slotId, pickingAgentId);
        setPickingAgentId(undefined);
    }

    return (
        <Modal onClose={close} wide label={mission.data.displayName ?? 'Mission'}>
            <div className="modal__body">
                <div className="summary">
                    <div className="summary__left">
                        <div className="summary__photo">NO IMAGE</div>
                        <hr className="summary__dashrule" />
                        <LocationBlock mission={mission} />
                    </div>

                    <div className="summary__divider">
                        <span className="summary__dot" aria-hidden="true" />
                    </div>

                    <div className="summary__right">
                        <h2 className="summary__name">{mission.data.displayName}</h2>

                        <div className="summary__row">
                            <span className="chip">{mission.data.type ?? 'contract'}</span>
                            <DifficultyPips level={mission.data.difficultyLevel} />
                        </div>

                        {mission.data.hint ? (
                            <p className="hint">
                                <Emphasized text={mission.data.hint} terms={keywordTerms} />
                            </p>
                        ) : null}

                        {mission.data.description ? (
                            <p className="summary__body">
                                <Emphasized text={mission.data.description} terms={keywordTerms} />
                            </p>
                        ) : null}

                        <div className="tabrow" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                className="tabrow__tab"
                                aria-selected={tab === 'details'}
                                onClick={() => setTab('details')}
                            >
                                Details
                            </button>
                            <button
                                type="button"
                                role="tab"
                                className="tabrow__tab"
                                aria-selected={tab === 'assignment'}
                                onClick={() => setTab('assignment')}
                            >
                                Assignment
                            </button>
                        </div>

                        {tab === 'details' ? (
                            <DetailsTab mission={mission} tables={tables} />
                        ) : (
                            <AssignmentTab
                                session={session}
                                tables={tables}
                                pickingAgentId={pickingAgentId}
                                onPickSlot={placeInSlot}
                                onUnassign={unassignAgent}
                                failure={failure}
                                setFailure={setFailure}
                            />
                        )}
                    </div>
                </div>
            </div>

            <div className="roster loadout__roster">
                {roster.length === 0 ? (
                    <span className="meta">No agents employed.</span>
                ) : (
                    roster.map((agent) => (
                        <AgentCard
                            key={agent.characterId}
                            agent={agent}
                            selected={agent.characterId === pickingAgentId}
                            disabled={!runtimeAgent.isAvailable(agent)}
                            onClick={() => {
                                setFailure('');
                                setPickingAgentId((current) =>
                                    current === agent.characterId ? undefined : agent.characterId,
                                );
                            }}
                        />
                    ))
                )}
            </div>

            <div className="modal__footer">
                <button
                    type="button"
                    className="btn btn--quiet footer-left"
                    onClick={() => setConfirmingDecline(true)}
                    disabled={!canDecline}
                    title={canDecline ? undefined : 'This client does not take no for an answer'}
                >
                    Decline
                </button>
                <span className="meta">
                    {session.canConfirm
                        ? 'Ready to deploy'
                        : `Fill ${session.missingMandatorySlots.length} more slot(s)`}
                </span>
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={deploy}
                    disabled={!session.canConfirm}
                >
                    Deploy
                </button>
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
        </Modal>
    );
}

/** Location name, address and coordinates, sitting under the photo's fade. */
function LocationBlock({ mission }: { mission: LiveMission }): ReactNode {
    const [expanded, setExpanded] = useState(false);
    const location = mission.location;

    return (
        <div className="summary__location">
            <span className="summary__location-name">{location?.displayName ?? 'Unknown'}</span>
            <span className="summary__location-detail">
                {location?.address ?? titleCase(location?.country) ?? 'Location withheld'}
            </span>
            <span className="summary__location-detail">
                {formatCoordinate(location?.latitude, 'N', 'S')}{' '}
                {formatCoordinate(location?.longitude, 'E', 'W')}
            </span>

            {expanded ? (
                <span className="summary__location-detail dim">
                    {[location?.type, location?.locationSize, location?.state]
                        .filter(Boolean)
                        .join(' · ') || 'No further detail on file'}
                </span>
            ) : null}

            {/* UIMissionLink. There is no deeper location view in v1, so it discloses the rest of
                what the Location row actually carries rather than pretending to navigate. */}
            <button type="button" className="mission-link" onClick={() => setExpanded(!expanded)}>
                {expanded ? '‹ Less' : 'More ›'}
            </button>
        </div>
    );
}

/**
 * Tasks and rewards.
 *
 * The sketch puts a Task list here. v1 cuts Tasks, so the list renders whatever `starterTasks`
 * resolves to and says plainly when there is nothing — which is honest now and fills itself in
 * once Tasks are authored, rather than needing this rewritten.
 */
function DetailsTab({ mission, tables }: { mission: LiveMission; tables: GameTables }): ReactNode {
    const tasks = tables.Task.getMany(mission.data.starterTasks);
    const reward = rewardOf(tables, mission.data.outcomes?.[0]);

    return (
        <div className="tabpanel" role="tabpanel">
            <div>
                <div className="summary__label">Tasks</div>
                <div className="marker-list">
                    {tasks.length ? (
                        tasks.map((task) => (
                            <div className="marker-row" key={task.taskId}>
                                <span className="marker" />
                                <span>{task.displayName ?? task.taskId}</span>
                                <span className="marker-row__note">
                                    {task.minDurationInHours ? `${task.minDurationInHours}h` : ''}
                                </span>
                            </div>
                        ))
                    ) : (
                        <div className="marker-row">
                            <span className="marker" />
                            <span className="dim">
                                Single operation. Tasks are not modelled in this prototype.
                            </span>
                            <span />
                        </div>
                    )}
                </div>
            </div>

            <div>
                <div className="summary__label">Rewards</div>
                <div className="reward-row">
                    <div className="reward-box hatch">
                        <span className="reward-box__value">
                            {reward.money ? `$${reward.money.toLocaleString('en-US')}` : '—'}
                        </span>
                        <span className="reward-box__unit">payment</span>
                    </div>
                    <div className="reward-box hatch">
                        <span className="reward-box__value">{reward.exp || '—'}</span>
                        <span className="reward-box__unit">exp</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Who goes, and what they carry — the real Loadout, in place.
 *
 * A Mission has no slot list of its own — the slots are whatever its start Gate names, in authored
 * order, and `session.slots` is that list. Tap an agent in the roster strip below, then tap an empty
 * slot here to place them; an occupied slot clears with its 'x'.
 */
function AssignmentTab({
    session,
    tables,
    pickingAgentId,
    onPickSlot,
    onUnassign,
    failure,
    setFailure,
}: {
    session: LoadoutSession;
    tables: GameTables;
    pickingAgentId: string | undefined;
    onPickSlot: (slotId: string) => void;
    onUnassign: (slotId: string) => void;
    failure: string;
    setFailure: (message: string) => void;
}): ReactNode {
    const [kitTab, setKitTab] = useState<'shop' | 'inventory'>('shop');
    const [query, setQuery] = useState('');

    const assignedAgents = session.slots
        .map((slot) => session.agentIn(slot.slotId))
        .filter((agent): agent is NonNullable<typeof agent> => agent !== undefined);

    return (
        <div className="tabpanel" role="tabpanel">
            <div className="slot-grid">
                {session.slots.map((slot) => {
                    const occupant = session.agentIn(slot.slotId);
                    const className = [
                        'slot',
                        occupant ? 'slot--filled' : '',
                        !occupant && slot.isMandatory ? 'slot--needed' : '',
                    ]
                        .filter(Boolean)
                        .join(' ');

                    return (
                        <div className={className} key={slot.slotId}>
                            <div className="slot__head">
                                <span className="micro">
                                    {slot.slotId.replace(/^slot_/, '')}
                                    {slot.isMandatory ? '' : ' · optional'}
                                </span>
                            </div>

                            {occupant ? (
                                <>
                                    <button
                                        type="button"
                                        className="slot__remove"
                                        onClick={() => onUnassign(slot.slotId)}
                                        aria-label={`Remove ${runtimeAgent.displayName(occupant)}`}
                                    >
                                        ✕
                                    </button>
                                    <CarriedItems characterId={occupant.characterId} />
                                </>
                            ) : (
                                <button
                                    type="button"
                                    className="slot__empty"
                                    disabled={!pickingAgentId}
                                    onClick={() => onPickSlot(slot.slotId)}
                                >
                                    {pickingAgentId ? 'Tap to assign' : 'Select an agent below'}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <StatGauges agents={assignedAgents} tables={tables} />

            <div className="kit">
                <div className="tabs" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        className="tab"
                        aria-selected={kitTab === 'shop'}
                        onClick={() => setKitTab('shop')}
                    >
                        Shop
                    </button>
                    <button
                        type="button"
                        role="tab"
                        className="tab"
                        aria-selected={kitTab === 'inventory'}
                        onClick={() => setKitTab('inventory')}
                    >
                        Inventory
                    </button>
                </div>

                <input
                    className="search"
                    placeholder="Search kit…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />

                {failure ? <div className="meta danger">{failure}</div> : null}

                {kitTab === 'shop' ? (
                    <ShopList query={query} onFailure={setFailure} />
                ) : (
                    <InventoryList query={query} />
                )}
            </div>
        </div>
    );
}

/** The team's combined Stats, as 2-up gauges — full name on the left, bar and total on the right. */
function StatGauges({
    agents,
    tables,
}: {
    agents: readonly RuntimeAgent[];
    tables: GameTables;
}): ReactNode {
    return (
        <div className="stat-gauges">
            {STAT_IDS.map((stat) => {
                const total = agents.reduce((sum, agent) => sum + runtimeAgent.effectiveStats(agent).get(stat), 0);
                const definition = tables.Stat.get(stat);
                const cap = (definition?.maxValue ?? 20) * Math.max(1, agents.length);
                const ratio = cap > 0 ? Math.min(1, total / cap) : 0;

                return (
                    <div className="stat-gauge" key={stat}>
                        <span className="stat-gauge__label">{definition?.displayName ?? stat.toUpperCase()}</span>
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

/** Assigning an item transfers real stock out of the pool, so the counts here are the truth. */
function ShopList({
    query,
    onFailure,
}: {
    query: string;
    onFailure: (message: string) => void;
}): ReactNode {
    useGame((state) => state.version);

    const session = useGame((state) => state.session)!;
    const purchase = useGame((state) => state.purchaseItem);

    const items = useMemo(
        () => filterItems(session.shop.availableItems(), query),
        [session, query],
    );

    return (
        <div className="item-list">
            {items.map((item) => {
                const price = session.shop.priceOf(item.itemId!)?.qty ?? 0;
                const failure = session.shop.checkPurchase(item.itemId!, 1);

                return (
                    <div className="item-row" key={item.itemId}>
                        <span>
                            <span className="item-row__name">{item.displayName ?? item.itemId}</span>
                            <br />
                            <span className="item-row__effects">{describeEffects(item)}</span>
                        </span>
                        <span className="item-row__price">${price.toLocaleString('en-US')}</span>
                        <button
                            type="button"
                            className="btn btn--small"
                            disabled={failure !== 'none'}
                            title={describePurchaseFailure(failure)}
                            onClick={() => {
                                onFailure('');
                                const result = session.shop.checkPurchase(item.itemId!, 1);
                                if (result !== 'none') onFailure(describePurchaseFailure(result));
                                else purchase(item.itemId!, 1);
                            }}
                        >
                            Buy
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

/** What the agency owns, and who to hand it to. */
function InventoryList({ query }: { query: string }): ReactNode {
    useGame((state) => state.version);

    const session = useGame((state) => state.session)!;
    const tables = useGame((state) => state.tables)!;
    const inventory = useGame((state) => state.inventory);
    const assignItem = useGame((state) => state.assignItem);

    const carriers = session.slots
        .map((slot) => session.agentIn(slot.slotId))
        .filter((agent): agent is NonNullable<typeof agent> => agent !== undefined);

    const owned = inventory.entries
        .filter(([itemId]) => itemId !== 'dollar')
        .map(([itemId, qty]) => ({ item: tables.Item.get(itemId), itemId, qty }))
        .filter((entry) => entry.item)
        .filter((entry) => matches(entry.item!, query));

    if (!owned.length) {
        return (
            <div className="item-list">
                <p className="meta">Nothing in stock. Buy something from the Shop tab.</p>
            </div>
        );
    }

    return (
        <div className="item-list">
            {owned.map(({ item, itemId, qty }) => (
                <div className="item-row" key={itemId}>
                    <span>
                        <span className="item-row__name">
                            {item!.displayName ?? itemId} ×{qty}
                        </span>
                        <br />
                        <span className="item-row__effects">{describeEffects(item!)}</span>
                    </span>
                    <span />
                    <span style={{ display: 'flex', gap: 4 }}>
                        {carriers.length === 0 ? (
                            <span className="meta dim">assign an agent first</span>
                        ) : (
                            carriers.map((agent) => (
                                <button
                                    type="button"
                                    key={agent.characterId}
                                    className="btn btn--small"
                                    disabled={session.remainingCapacity(agent.characterId) < 1}
                                    onClick={() => assignItem(agent.characterId, itemId, 1)}
                                    title={`Give to ${runtimeAgent.displayName(agent)}`}
                                >
                                    → {runtimeAgent.displayName(agent)}
                                </button>
                            ))
                        )}
                    </span>
                </div>
            ))}
        </div>
    );
}

function CarriedItems({ characterId }: { characterId: string }): ReactNode {
    useGame((state) => state.version);

    const session = useGame((state) => state.session)!;
    const tables = useGame((state) => state.tables)!;
    const unassignItem = useGame((state) => state.unassignItem);

    const agent = session.agentIn(session.slotOf(characterId) ?? '')!;
    const carried = session.carriedBy(characterId).entries;
    const capacity = runtimeAgent.inventorySize(agent);

    return (
        <div>
            <div className="agent-card__name">{runtimeAgent.displayName(agent)}</div>
            <div className="statline" style={{ marginTop: 6 }}>
                {STAT_IDS.map((stat) => (
                    <span key={stat}>
                        {stat.toUpperCase()} <b>{runtimeAgent.effectiveStats(agent).get(stat)}</b>
                    </span>
                ))}
            </div>

            <div className="carry">
                <div className="micro dim">
                    Carrying {carried.reduce((sum, [, qty]) => sum + qty, 0)} / {capacity}
                </div>
                {carried.map(([itemId, qty]) => (
                    <div className="carry__row" key={itemId}>
                        <span>
                            {tables.Item.get(itemId)?.displayName ?? itemId} ×{qty}
                        </span>
                        <button
                            type="button"
                            className="btn btn--small btn--quiet"
                            onClick={() => unassignItem(characterId, itemId, 1)}
                        >
                            Return
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function filterItems(items: readonly ItemData[], query: string): ItemData[] {
    return items.filter((item) => matches(item, query));
}

function matches(item: ItemData, query: string): boolean {
    if (!query.trim()) return true;
    const haystack = [item.itemId, item.displayName, item.subType, ...(item.type ?? []), ...(item.tags ?? [])]
        .join(' ')
        .toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
}

/** The stat swing an item gives, which is the only thing about it a Gate can see. */
function describeEffects(item: ItemData): string {
    const parts = STAT_IDS.map((stat) => {
        const value = item[`${stat}Effect` as keyof ItemData] as number | undefined;
        return value ? `${stat.toUpperCase()} +${value}` : '';
    }).filter(Boolean);

    const consumable = item.isGoneAfterUse ? 'single use' : '';
    return [...parts, consumable].filter(Boolean).join(' · ') || '—';
}

function rewardOf(
    tables: GameTables,
    bestOutcomeId: string | undefined,
): { money: number; exp: number } {
    const outcome = tables.Outcome.get(bestOutcomeId);
    const incidents = tables.Incident.getMany(outcome?.incidents);

    let money = 0;
    let exp = 0;
    for (const incident of incidents) {
        exp += incident.rewardExp ?? 0;
        for (const reward of incident.rewardItems ?? []) {
            if (reward.itemId === 'dollar') money += reward.qty ?? 0;
        }
    }

    return { money, exp };
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
