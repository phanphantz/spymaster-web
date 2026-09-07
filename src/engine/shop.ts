import type { Inventory } from './container';
import { DOLLAR, type ItemAmount, type ItemData, type Table } from './types';

/**
 * The Shop, over the player's own inventory.
 *
 * Port of `Assets/Scripts/Spymaster/Missions/Loadout/ShopModel.cs`.
 *
 * Money is an Item, so a purchase is a transfer inside one pool rather than a separate economy: an
 * item's price is itself an item id and a quantity, and in practice that id is always `dollar`.
 */

export type PurchaseFailure =
    | 'none'
    | 'unknownItem'
    | 'notInShop'
    | 'playerLevelTooLow'
    | 'ownedCountReached'
    | 'cannotAfford';

export class Shop {
    constructor(
        private readonly items: Table<ItemData>,
        private readonly inventory: Inventory,
        public playerLevel: number,
    ) {}

    /** Listed items, in table order. */
    availableItems(): ItemData[] {
        return this.items.rows.filter(
            (item) => item.isInShop && (item.minPlayerLevel ?? 0) <= this.playerLevel,
        );
    }

    priceOf(itemId: string, qty = 1): ItemAmount | undefined {
        const item = this.items.get(itemId);
        if (!item) return undefined;
        return { itemId: item.priceItemId ?? DOLLAR, qty: (item.priceItemQty ?? 0) * qty };
    }

    ownedCount(itemId: string): number {
        return this.inventory.get(itemId);
    }

    /**
     * How many more of this item the player may own.
     *
     * An unauthored `maxOwnedCount` of 0 reads as unlimited, exactly as -1 does. That is a quirk
     * rather than a design choice, but changing it would make every unauthored item unbuyable, so
     * the Unity behaviour is kept.
     */
    remainingAllowance(itemId: string): number {
        const item = this.items.get(itemId);
        if (!item) return 0;

        const max = item.maxOwnedCount ?? 0;
        if (max <= 0) return Number.POSITIVE_INFINITY;
        return Math.max(0, max - this.ownedCount(itemId));
    }

    /** Checks in the same order as Unity, so the reason shown to the player matches. */
    checkPurchase(itemId: string, qty = 1): PurchaseFailure {
        const item = this.items.get(itemId);
        if (!item) return 'unknownItem';
        if (!item.isInShop) return 'notInShop';
        if ((item.minPlayerLevel ?? 0) > this.playerLevel) return 'playerLevelTooLow';
        if (this.remainingAllowance(itemId) < qty) return 'ownedCountReached';

        const price = this.priceOf(itemId, qty);
        if (price && this.inventory.get(price.itemId ?? DOLLAR) < (price.qty ?? 0)) {
            return 'cannotAfford';
        }

        return 'none';
    }

    /** All or nothing: the money leaves and the item arrives, or neither happens. */
    purchase(itemId: string, qty = 1): PurchaseFailure {
        const failure = this.checkPurchase(itemId, qty);
        if (failure !== 'none') return failure;

        const price = this.priceOf(itemId, qty)!;
        this.inventory.remove(price.itemId ?? DOLLAR, price.qty ?? 0);
        this.inventory.add(itemId, qty);
        return 'none';
    }
}

export function describePurchaseFailure(failure: PurchaseFailure): string {
    switch (failure) {
        case 'none':
            return '';
        case 'unknownItem':
            return 'No such item';
        case 'notInShop':
            return 'Not for sale';
        case 'playerLevelTooLow':
            return 'Locked at your level';
        case 'ownedCountReached':
            return 'You already hold as many as you may';
        case 'cannotAfford':
            return 'Not enough money';
    }
}
