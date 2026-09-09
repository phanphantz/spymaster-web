import { useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import * as runtimeAgent from '../../engine/runtimeAgent';
import { describePurchaseFailure } from '../../engine/shop';
import { StatAbbr } from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { ItemData } from '../../engine/types';

/** camelCase id → Title Case label, for the subtype row — there's no vocabulary tab for these. */
function humanize(id: string): string {
    return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

/** Up to two letters standing in for an item's icon — nothing in the data has real art per item. */
function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

/** The stat swing an item gives, which is the only thing about it a Gate can see. */
function describeEffects(item: ItemData): ReactNode {
    const stats = STAT_IDS.filter((stat) => Boolean(item[`${stat}Effect` as keyof ItemData]));

    if (!stats.length && !item.isGoneAfterUse) return '—';

    return (
        <>
            {stats.map((stat, index) => (
                <span key={stat}>
                    {index > 0 ? ' · ' : ''}
                    <StatAbbr stat={stat} /> +{item[`${stat}Effect` as keyof ItemData] as number}
                </span>
            ))}
            {item.isGoneAfterUse ? <span key="consumable">{stats.length ? ' · ' : ''}single use</span> : null}
        </>
    );
}

/**
 * The Kit page: buy and equip in one catalog, focused on whichever agent's pencil opened it.
 *
 * Splitting Shop from Inventory never earned its keep — an item is either owned or not, and the
 * owned count on each row says which; there is nothing a second tab was showing that this doesn't.
 * Type sits on the left and subtype across the top, both authored on the Item sheet, which sorts a
 * few hundred rows into something browsable without a search box. Done returns to the mission modal
 * on whichever tab was open when the pencil was tapped — Assignment, always, since that's the only
 * place the pencil lives.
 */
export function ShopScreen(): ReactNode {
    useGame((state) => state.version);

    const session = useGame((state) => state.session);
    const tables = useGame((state) => state.tables);
    const roster = useGame((state) => state.roster);
    const shopCharacterId = useGame((state) => state.shopCharacterId);
    const closeShop = useGame((state) => state.closeShop);
    const purchase = useGame((state) => state.purchaseItem);
    const assignItem = useGame((state) => state.assignItem);
    const unassignItem = useGame((state) => state.unassignItem);

    const [failure, setFailure] = useState('');
    const [typeId, setTypeId] = useState<string>();
    const [subType, setSubType] = useState<string>();

    if (!session || !tables || !shopCharacterId) return null;
    const agent = roster.find((candidate) => candidate.characterId === shopCharacterId);
    if (!agent) return null;

    const items = session.shop.availableItems();

    const presentTypes = new Set(items.flatMap((item) => item.type ?? []));
    const types = tables.ItemType.rows.filter((row) => row.itemTypeId && presentTypes.has(row.itemTypeId));
    const activeType = typeId && presentTypes.has(typeId) ? typeId : types[0]?.itemTypeId;

    const itemsOfType = items.filter((item) => (item.type ?? []).includes(activeType ?? ''));
    const subtypes = Array.from(
        new Set(itemsOfType.map((item) => item.subType).filter((value): value is string => Boolean(value))),
    );
    const filtered = subType ? itemsOfType.filter((item) => item.subType === subType) : itemsOfType;

    const carried = session.carriedBy(shopCharacterId).entries;
    const capacity = runtimeAgent.inventorySize(agent);

    function selectType(next: string): void {
        setTypeId(next);
        setSubType(undefined);
    }

    return (
        <div className="shop">
            <div className="shop__header">
                <div>
                    <h1 className="title">{runtimeAgent.displayName(agent)}’s Kit</h1>
                    <span className="meta">
                        Carrying {carried.reduce((sum, [, qty]) => sum + qty, 0)} / {capacity}
                    </span>
                </div>
                <button type="button" className="btn btn--primary" onClick={closeShop}>
                    Done
                </button>
            </div>

            <div className="shop__equipped">
                {carried.length === 0 ? (
                    <span className="meta dim">Nothing equipped.</span>
                ) : (
                    carried.map(([itemId, qty]) => {
                        const item = tables.Item.get(itemId);
                        const name = item?.displayName ?? itemId;
                        return (
                            <button
                                type="button"
                                key={itemId}
                                className="equip-icon"
                                onClick={() => unassignItem(shopCharacterId, itemId, 1)}
                                title={`${name} ×${qty} — tap to unequip`}
                            >
                                <span className="equip-icon__glyph">{initials(name)}</span>
                                {qty > 1 ? <span className="equip-icon__qty">×{qty}</span> : null}
                            </button>
                        );
                    })
                )}
            </div>

            <div className="shop__body">
                <div className="shop__types">
                    {types.map((row) => (
                        <button
                            type="button"
                            key={row.itemTypeId}
                            className="shop__type"
                            aria-selected={row.itemTypeId === activeType}
                            onClick={() => selectType(row.itemTypeId!)}
                        >
                            {row.displayName ?? row.itemTypeId}
                        </button>
                    ))}
                </div>

                <div className="shop__main">
                    <div className="tabs shop__subtypes" role="tablist">
                        <button
                            type="button"
                            role="tab"
                            className="tab"
                            aria-selected={!subType}
                            onClick={() => setSubType(undefined)}
                        >
                            All
                        </button>
                        {subtypes.map((st) => (
                            <button
                                type="button"
                                role="tab"
                                key={st}
                                className="tab"
                                aria-selected={subType === st}
                                onClick={() => setSubType(st)}
                            >
                                {humanize(st)}
                            </button>
                        ))}
                    </div>

                    {failure ? <div className="meta danger">{failure}</div> : null}

                    <div className="shop-items">
                        {filtered.map((item) => {
                            const owned = session.shop.ownedCount(item.itemId!);
                            const price = session.shop.priceOf(item.itemId!)?.qty ?? 0;
                            const buyFailure = session.shop.checkPurchase(item.itemId!, 1);
                            const outOfCapacity = session.remainingCapacity(shopCharacterId) < 1;

                            return (
                                <div className="item-row" key={item.itemId}>
                                    <span>
                                        <span className="item-row__name">
                                            {item.displayName ?? item.itemId}
                                            <span className="shop-item__owned"> · owned {owned}</span>
                                        </span>
                                        <br />
                                        <span className="item-row__effects">{describeEffects(item)}</span>
                                    </span>
                                    <span className="item-row__price">${price.toLocaleString('en-US')}</span>
                                    <span className="shop-item__actions">
                                        <button
                                            type="button"
                                            className="btn btn--small"
                                            disabled={buyFailure !== 'none'}
                                            title={describePurchaseFailure(buyFailure)}
                                            onClick={() => {
                                                setFailure('');
                                                const result = session.shop.checkPurchase(item.itemId!, 1);
                                                if (result !== 'none') setFailure(describePurchaseFailure(result));
                                                else purchase(item.itemId!, 1);
                                            }}
                                        >
                                            Buy
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn--small btn--primary"
                                            disabled={owned < 1 || outOfCapacity}
                                            title={owned < 1 ? 'None owned' : outOfCapacity ? 'Carrying at capacity' : undefined}
                                            onClick={() => assignItem(shopCharacterId, item.itemId!, 1)}
                                        >
                                            Equip
                                        </button>
                                    </span>
                                </div>
                            );
                        })}
                        {filtered.length === 0 ? <p className="meta">Nothing here.</p> : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
