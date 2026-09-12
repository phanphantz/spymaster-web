import { useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import { describePurchaseFailure } from '../../engine/shop';
import { StatAbbr, initials } from '../components/bits';
import { STAT_IDS } from '../../engine/types';
import type { GameTables, ItemData } from '../../engine/types';
import type { LoadoutSession } from '../../engine/loadout';

/** camelCase id → Title Case label, for the subtype row — there's no vocabulary tab for these. */
function humanize(id: string): string {
    return id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
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
 * The Kit page: browse and buy the whole catalog, then drag what you own onto whoever's carrying it
 * — the agent inventory row below the modal (`WorldMapScreen`'s roster strip, switched into that
 * mode for as long as this is open). There is no one focused agent here the way the old per-agent
 * Shop had: any assigned teammate can receive a drop, so the catalog stays one shared browse instead
 * of a tab per agent.
 *
 * Mirrors the Mission UI's own three-column grid (`.summary`) so switching into Kit mode reads as
 * the same modal changing what fills its columns, not a different screen replacing it: type sits in
 * the left rail exactly where the photo/location used to be, subtype and the grid take the middle
 * where the briefing did, and the always-visible right rail becomes one item's detail instead of the
 * team's combined stats.
 */
export function ShopScreen({
    session,
    tables,
    onDone,
}: {
    session: LoadoutSession;
    tables: GameTables;
    onDone: () => void;
}): ReactNode {
    useGame((state) => state.version);
    const purchase = useGame((state) => state.purchaseItem);

    const [failure, setFailure] = useState('');
    const [typeId, setTypeId] = useState<string>();
    const [subType, setSubType] = useState<string>();
    const [selectedItemId, setSelectedItemId] = useState<string>();

    const items = session.shop.availableItems();

    const presentTypes = new Set(items.flatMap((item) => item.type ?? []));
    const types = tables.ItemType.rows.filter((row) => row.itemTypeId && presentTypes.has(row.itemTypeId));
    const activeType = typeId && presentTypes.has(typeId) ? typeId : types[0]?.itemTypeId;

    const itemsOfType = items.filter((item) => (item.type ?? []).includes(activeType ?? ''));
    const subtypes = Array.from(
        new Set(itemsOfType.map((item) => item.subType).filter((value): value is string => Boolean(value))),
    );
    const filtered = subType ? itemsOfType.filter((item) => item.subType === subType) : itemsOfType;

    const selectedItem = selectedItemId ? tables.Item.get(selectedItemId) : undefined;

    function selectType(next: string): void {
        setTypeId(next);
        setSubType(undefined);
    }

    return (
        <div className="summary">
            <div className="summary__left">
                <h2 className="summary__name inv__title">Kit</h2>
                <div className="shop__types inv__types">
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
                <div className="summary__lower-anchor">
                    <div className="summary__actions summary__actions--right">
                        <button type="button" className="btn btn--quiet" onClick={onDone}>
                            Done
                        </button>
                    </div>
                </div>
            </div>

            <div className="summary__divider" />

            <div className="summary__right">
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

                <div className="inv-grid">
                    {filtered.map((item) => {
                        const owned = session.shop.ownedCount(item.itemId!);
                        const price = session.shop.priceOf(item.itemId!)?.qty ?? 0;

                        return (
                            <button
                                type="button"
                                key={item.itemId}
                                className="item-tile"
                                aria-selected={selectedItemId === item.itemId}
                                draggable={owned > 0}
                                onDragStart={(event) => {
                                    event.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.itemId }));
                                    event.dataTransfer.effectAllowed = 'copy';
                                }}
                                onClick={() => setSelectedItemId(item.itemId)}
                            >
                                <span className="item-tile__icon" aria-hidden="true">
                                    {initials(item.displayName ?? item.itemId ?? '?')}
                                </span>
                                <span className="item-tile__name">{item.displayName ?? item.itemId}</span>
                                <span className="item-tile__meta">
                                    <span className="item-tile__price">${price.toLocaleString('en-US')}</span>
                                    <span className="item-tile__owned">owned {owned}</span>
                                </span>
                            </button>
                        );
                    })}
                    {filtered.length === 0 ? <p className="meta">Nothing here.</p> : null}
                </div>
            </div>

            <div className="summary__stats">
                {selectedItem ? (
                    <ItemDetail
                        item={selectedItem}
                        owned={session.shop.ownedCount(selectedItem.itemId!)}
                        price={session.shop.priceOf(selectedItem.itemId!)?.qty ?? 0}
                        failure={failure}
                        onBuy={() => {
                            setFailure('');
                            const result = session.shop.checkPurchase(selectedItem.itemId!, 1);
                            if (result !== 'none') setFailure(describePurchaseFailure(result));
                            else purchase(selectedItem.itemId!, 1);
                        }}
                        canBuy={session.shop.checkPurchase(selectedItem.itemId!, 1) === 'none'}
                        buyDisabledReason={describePurchaseFailure(session.shop.checkPurchase(selectedItem.itemId!, 1))}
                    />
                ) : (
                    <div className="inv-detail inv-detail--empty">
                        <span className="meta dim">Select an item.</span>
                    </div>
                )}
            </div>
        </div>
    );
}

/** The right rail while an item is selected — its stat swing, description, owned/price, and Buy.
 *  Equipping is drag-only, onto the agent inventory row below, so there is no Equip button here. */
function ItemDetail({
    item,
    owned,
    price,
    failure,
    canBuy,
    buyDisabledReason,
    onBuy,
}: {
    item: ItemData;
    owned: number;
    price: number;
    failure: string;
    canBuy: boolean;
    buyDisabledReason: string;
    onBuy: () => void;
}): ReactNode {
    return (
        <div className="inv-detail">
            <div className="inv-detail__scroll">
                <h3 className="inv-detail__name">{item.displayName ?? item.itemId}</h3>
                <div className="inv-detail__effects">{describeEffects(item)}</div>
                {item.description ? <p className="inv-detail__desc">{item.description}</p> : null}
            </div>
            <div className="summary__lower-anchor">
                <hr className="summary__dashrule" />
                <div className="inv-detail__row">
                    <span className="inv-detail__price">${price.toLocaleString('en-US')}</span>
                    <span className="meta dim">owned {owned}</span>
                </div>
                {failure ? <div className="meta danger">{failure}</div> : null}
                <div className="summary__actions summary__actions--right">
                    <button
                        type="button"
                        className="btn btn--primary"
                        disabled={!canBuy}
                        title={canBuy ? undefined : buyDisabledReason}
                        onClick={onBuy}
                    >
                        Buy
                    </button>
                </div>
            </div>
        </div>
    );
}
