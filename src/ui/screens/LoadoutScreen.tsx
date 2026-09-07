import { useMemo, useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import { describeReason } from '../../engine/slotRequirementEvaluator';
import { describePurchaseFailure } from '../../engine/shop';
import { STAT_IDS, type ItemData } from '../../engine/types';
import { Modal, Money } from '../components/bits';

/**
 * The Loadout page: who goes, and what they carry.
 *
 * Assignment is tap-to-place rather than drag-and-drop. Drag reads well with a mouse and badly with
 * a thumb, and this prototype is meant to be openable on a phone.
 */
export function LoadoutScreen(): ReactNode {
    useGame((state) => state.version);

    const session = useGame((state) => state.session);
    const tables = useGame((state) => state.tables);
    const assignAgent = useGame((state) => state.assignAgent);
    const unassignAgent = useGame((state) => state.unassignAgent);
    const cancel = useGame((state) => state.cancelLoadout);
    const deployMission = useGame((state) => state.deployMission);

    const [tab, setTab] = useState<'shop' | 'inventory'>('shop');
    const [query, setQuery] = useState('');
    const [failure, setFailure] = useState('');

    if (!session || !tables) return null;

    const assignedAgents = session.slots
        .map((slot) => session.agentIn(slot.slotId))
        .filter((agent): agent is NonNullable<typeof agent> => agent !== undefined);

    return (
        <Modal onClose={cancel} wide label={`Loadout: ${session.mission.data.displayName}`}>
            <div className="modal__body">
                <div className="loadout">
                    <div className="loadout__slots">
                        <div>
                            <h2 className="title">{session.mission.data.displayName}</h2>
                            <p className="meta">{session.mission.location?.displayName}</p>
                        </div>

                        {session.mission.data.hint ? (
                            <p className="hint">“{session.mission.data.hint}”</p>
                        ) : null}

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
                                        {occupant ? (
                                            <button
                                                type="button"
                                                className="btn btn--small btn--quiet"
                                                onClick={() => unassignAgent(slot.slotId)}
                                            >
                                                Remove
                                            </button>
                                        ) : null}
                                    </div>

                                    {occupant ? (
                                        <CarriedItems characterId={occupant.characterId} />
                                    ) : (
                                        <div className="candidate-list">
                                            {session.candidatesFor(slot.slotId).map((candidate) => (
                                                <button
                                                    type="button"
                                                    key={candidate.agent.characterId}
                                                    className="candidate"
                                                    disabled={!candidate.isEligible}
                                                    onClick={() =>
                                                        assignAgent(
                                                            slot.slotId,
                                                            candidate.agent.characterId,
                                                        )
                                                    }
                                                >
                                                    {runtimeAgent.displayName(candidate.agent)}
                                                    {candidate.reasons.length ? (
                                                        <span className="candidate__why">
                                                            {describeReason(candidate.reasons[0])}
                                                        </span>
                                                    ) : null}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {assignedAgents.length ? (
                            <div className="meta">
                                Combined:{' '}
                                {STAT_IDS.map((stat) => {
                                    const total = assignedAgents.reduce(
                                        (sum, agent) => sum + runtimeAgent.effectiveStats(agent).get(stat),
                                        0,
                                    );
                                    return `${stat.toUpperCase()} ${total}`;
                                }).join('  ')}
                            </div>
                        ) : null}
                    </div>

                    <div className="loadout__market">
                        <div className="tabs" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                className="tab"
                                aria-selected={tab === 'shop'}
                                onClick={() => setTab('shop')}
                            >
                                Shop
                            </button>
                            <button
                                type="button"
                                role="tab"
                                className="tab"
                                aria-selected={tab === 'inventory'}
                                onClick={() => setTab('inventory')}
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

                        {tab === 'shop' ? (
                            <ShopList query={query} onFailure={setFailure} />
                        ) : (
                            <InventoryList query={query} />
                        )}
                    </div>
                </div>
            </div>

            <div className="modal__footer">
                <span className="meta">
                    {session.canConfirm
                        ? 'Ready to deploy'
                        : `Fill ${session.missingMandatorySlots.length} more slot(s)`}
                </span>
                <button type="button" className="btn btn--quiet" onClick={cancel}>
                    Back
                </button>
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={deployMission}
                    disabled={!session.canConfirm}
                >
                    Deploy
                </button>
            </div>
        </Modal>
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

export { Money };
