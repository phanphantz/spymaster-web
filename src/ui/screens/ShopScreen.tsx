import { useState, type ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import { describeEquipFailure } from '../../engine/shop';
import { PageTabs, StatAbbr, initials, setSquareDragImage } from '../components/bits';
import { RARITY_TIERS, STAT_IDS } from '../../engine/types';
import type { GameTables, ItemData, VocabularyEntry } from '../../engine/types';
import type { LoadoutSession } from '../../engine/loadout';

/** The order the type rail should read in, top to bottom — matched against each row's own
 *  `displayName` (case-insensitive) rather than its `itemTypeId`, since the id spelling is
 *  authored in the sheet and not guaranteed to match this literally. Anything not named here keeps
 *  whatever order the sheet gave it, after all of these. */
const TYPE_ORDER = ['Tool', 'Close Range Weapon', 'Long Range Weapon', 'Explosive'];

function sortTypes(rows: readonly VocabularyEntry[]): VocabularyEntry[] {
    const rankOf = (row: VocabularyEntry): number => {
        const label = (row.displayName ?? row.itemTypeId ?? '').toLowerCase();
        const index = TYPE_ORDER.findIndex((name) => name.toLowerCase() === label);
        return index === -1 ? TYPE_ORDER.length : index;
    };
    return [...rows].sort((a, b) => rankOf(a) - rankOf(b));
}

/** Not modelled in this prototype yet — no attachment slots on a weapon. Hidden from the type rail
 *  entirely rather than left to dead-end as an empty tab; an item that carries this as a secondary
 *  type still shows under whichever other type it also has. */
const HIDDEN_TYPES = new Set(['attachment']);

type SortKey = 'name' | 'price' | 'rarity' | 'stats';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
    { key: 'name', label: 'A–Z' },
    { key: 'price', label: 'Price' },
    { key: 'rarity', label: 'Rarity' },
    { key: 'stats', label: 'Total Stats' },
];

const RARITY_RANK: Record<string, number> = Object.fromEntries(RARITY_TIERS.map((tier, index) => [tier, index]));

/** Sum of an item's six stat effects — the same total the right rail's stat-swing line reads off. */
function totalStatsOf(item: ItemData): number {
    return STAT_IDS.reduce((sum, stat) => sum + ((item[`${stat}Effect` as keyof ItemData] as number) || 0), 0);
}

/** Ties break on display name, so re-sorting by the same key never reshuffles items that are equal
 *  under it — Price or Rarity groups plenty of items onto the same value. */
function sortItems(items: readonly ItemData[], key: SortKey, dir: SortDir, session: LoadoutSession): ItemData[] {
    const nameOf = (item: ItemData) => (item.displayName ?? item.itemId ?? '').toLowerCase();
    const valueOf = (item: ItemData): number | string => {
        switch (key) {
            case 'name':
                return nameOf(item);
            case 'price':
                return session.shop.priceOf(item.itemId!)?.qty ?? 0;
            case 'rarity':
                // Unauthored rarity sorts as the least rare, rather than being pushed to either end.
                return RARITY_RANK[item._rarity ?? ''] ?? -1;
            case 'stats':
                return totalStatsOf(item);
        }
    };

    const sign = dir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
        const [va, vb] = [valueOf(a), valueOf(b)];
        const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : (va as number) - (vb as number);
        return cmp !== 0 ? sign * cmp : nameOf(a).localeCompare(nameOf(b));
    });
}

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
 * The Kit page: browse the whole catalog and drag any unlocked item straight onto whoever's meant
 * to carry it — the agent inventory row below the modal (`WorldMapScreen`'s roster strip, switched
 * into that mode for as long as this is open). There is no ownership step: every item listed is
 * already unlocked, and dropping one onto an agent charges its price on the spot, as the cost of
 * preparing for the job — undone (unassigned, swapped away, or the loadout cancelled) for a full
 * refund. There is no one focused agent here the way the old per-agent Shop had: any assigned
 * teammate can receive a drop, so the catalog stays one shared browse instead of a tab per agent.
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
    onSelectTab,
}: {
    session: LoadoutSession;
    tables: GameTables;
    /** Only ever called with 'agent' — this page IS the 'inventory' tab, so picking it again is a
     *  no-op the caller doesn't need to handle. */
    onSelectTab: (tab: 'agent' | 'inventory') => void;
}): ReactNode {
    useGame((state) => state.version);

    const [typeId, setTypeId] = useState<string>();
    const [subType, setSubType] = useState<string>();
    const [selectedItemId, setSelectedItemId] = useState<string>();
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    const items = session.shop.availableItems();

    const presentTypes = new Set(items.flatMap((item) => item.type ?? []));
    const types = sortTypes(
        tables.ItemType.rows.filter(
            (row) => row.itemTypeId && presentTypes.has(row.itemTypeId) && !HIDDEN_TYPES.has(row.itemTypeId),
        ),
    );
    const activeType = typeId && presentTypes.has(typeId) ? typeId : types[0]?.itemTypeId;

    const itemsOfType = items.filter((item) => (item.type ?? []).includes(activeType ?? ''));
    const subtypes = Array.from(
        new Set(itemsOfType.map((item) => item.subType).filter((value): value is string => Boolean(value))),
    );
    // No "All" tab — the first subtype stands in for it, the same way the first type does above.
    const activeSubType = subType && subtypes.includes(subType) ? subType : subtypes[0];
    const filtered = activeSubType ? itemsOfType.filter((item) => item.subType === activeSubType) : itemsOfType;
    const sorted = sortItems(filtered, sortKey, sortDir, session);

    const selectedItem = selectedItemId ? tables.Item.get(selectedItemId) : undefined;

    function selectType(next: string): void {
        setTypeId(next);
        setSubType(undefined);
    }

    /** Picking the already-active key flips its direction; picking a different one starts it
     *  ascending — the same toggle-or-switch convention the type/subtype tabs don't need, but a
     *  sort control does. */
    function toggleSort(key: SortKey): void {
        if (key === sortKey) setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
        else {
            setSortKey(key);
            setSortDir('asc');
        }
    }

    return (
        <div className="summary summary--kit">
            <div className="summary__left">
                <div className="sort-bar">
                    <span className="sort-bar__label micro">Sort</span>
                    <div className="sort-bar__options">
                        {SORT_OPTIONS.map(({ key, label }) => {
                            const active = sortKey === key;
                            return (
                                <button
                                    type="button"
                                    key={key}
                                    className="sort-chip"
                                    aria-selected={active}
                                    onClick={() => toggleSort(key)}
                                    title={`Sort by ${label}${active ? (sortDir === 'asc' ? ', ascending' : ', descending') : ''}`}
                                >
                                    {label}
                                    {active ? (
                                        <span className="sort-chip__dir" aria-hidden="true">
                                            {sortDir === 'asc' ? '▲' : '▼'}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
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
            </div>

            <div className="summary__divider" />

            <div className="summary__right">
                <div className="tabs shop__subtypes" role="tablist">
                    {subtypes.map((st) => (
                        <button
                            type="button"
                            role="tab"
                            key={st}
                            className="tab"
                            aria-selected={activeSubType === st}
                            onClick={() => setSubType(st)}
                        >
                            {humanize(st)}
                        </button>
                    ))}
                </div>

                <div className="inv-grid">
                    {sorted.map((item) => {
                        const price = session.shop.priceOf(item.itemId!)?.qty ?? 0;
                        const canEquip = session.shop.checkEquip(item.itemId!, 1) === 'none';

                        return (
                            <button
                                type="button"
                                key={item.itemId}
                                className="item-tile"
                                aria-selected={selectedItemId === item.itemId}
                                aria-disabled={!canEquip}
                                draggable
                                onDragStart={(event) => {
                                    event.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.itemId }));
                                    event.dataTransfer.effectAllowed = 'copy';
                                    setSquareDragImage(event, item.displayName ?? item.itemId ?? '?');
                                }}
                                onClick={() => setSelectedItemId(item.itemId)}
                            >
                                <span className="item-tile__icon" aria-hidden="true">
                                    {initials(item.displayName ?? item.itemId ?? '?')}
                                </span>
                                <span className="item-tile__name">{item.displayName ?? item.itemId}</span>
                                <span className="item-tile__meta">
                                    <span className="item-tile__price">${price.toLocaleString('en-US')}</span>
                                </span>
                            </button>
                        );
                    })}
                    {sorted.length === 0 ? <p className="meta">Nothing here.</p> : null}
                </div>
            </div>

            <div className="summary__stats">
                {/* Mirrors the Mission page's own stats rail: the icon sits where the team's
                    hexagon would, the name and detail sit in the lower group where the gauges
                    would — same column, same two-zone shape, just an item instead of a team. */}
                <div className="summary__photo summary__photo--stats">
                    {selectedItem ? (
                        <span className="inv-detail__icon" aria-hidden="true">
                            {initials(selectedItem.displayName ?? selectedItem.itemId ?? '?')}
                        </span>
                    ) : (
                        <p className="summary__stats-empty">Select an item to see its detail</p>
                    )}
                </div>
                <div className="summary__lower-anchor">
                    <hr className="summary__dashrule" />
                    {selectedItem ? (
                        <ItemDetail
                            item={selectedItem}
                            price={session.shop.priceOf(selectedItem.itemId!)?.qty ?? 0}
                            equipDisabledReason={describeEquipFailure(session.shop.checkEquip(selectedItem.itemId!, 1))}
                        />
                    ) : null}
                    <div className="summary__actions summary__actions--right">
                        <PageTabs active="inventory" onSelect={onSelectTab} />
                    </div>
                </div>
            </div>
        </div>
    );
}

/** The lower group of the item detail rail — name, stat swing, description and preparation cost.
 *  Equipping is drag-only, onto the agent inventory row below, so there is no button here — just
 *  the cost, and why dragging it over would fail right now, if it would. */
function ItemDetail({
    item,
    price,
    equipDisabledReason,
}: {
    item: ItemData;
    price: number;
    equipDisabledReason: string;
}): ReactNode {
    return (
        <div className="inv-detail">
            <h3 className="inv-detail__name">{item.displayName ?? item.itemId}</h3>
            <div className="inv-detail__effects">{describeEffects(item)}</div>
            {item.description ? <p className="inv-detail__desc">{item.description}</p> : null}
            <div className="inv-detail__row">
                <span className="inv-detail__price">${price.toLocaleString('en-US')}</span>
                <span className="meta dim">cost of preparation</span>
            </div>
            {equipDisabledReason ? <div className="meta danger">{equipDisabledReason}</div> : null}
        </div>
    );
}
