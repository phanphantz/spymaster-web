import type { Inventory } from './container';
import { DOLLAR, type ItemAmount, type ItemData, type Table } from './types';

/**
 * The Shop, as a price list over the player's money.
 *
 * Port of `Assets/Scripts/Spymaster/Missions/Loadout/ShopModel.cs`, simplified: there is no owned
 * stock any more. Every unlocked item (in the shop, at or under the player's level) can be equipped
 * onto an agent straight from the catalog — the price is charged the moment it's assigned, as the
 * cost of preparing for the job, and refunded if it's unassigned before deployment. Money is an
 * Item, so that charge is a transfer inside the one inventory pool rather than a separate economy.
 */

export type EquipFailure = 'none' | 'unknownItem' | 'notInShop' | 'playerLevelTooLow' | 'cannotAfford';

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

    /** Checks in the same order as Unity, so the reason shown to the player matches. */
    checkEquip(itemId: string, qty = 1): EquipFailure {
        const item = this.items.get(itemId);
        if (!item) return 'unknownItem';
        if (!item.isInShop) return 'notInShop';
        if ((item.minPlayerLevel ?? 0) > this.playerLevel) return 'playerLevelTooLow';

        const price = this.priceOf(itemId, qty);
        if (price && this.inventory.get(price.itemId ?? DOLLAR) < (price.qty ?? 0)) {
            return 'cannotAfford';
        }

        return 'none';
    }

    /** Charges the price as preparation cost. The caller places the item; this only moves the money. */
    charge(itemId: string, qty = 1): boolean {
        if (this.checkEquip(itemId, qty) !== 'none') return false;

        const price = this.priceOf(itemId, qty)!;
        this.inventory.remove(price.itemId ?? DOLLAR, price.qty ?? 0);
        return true;
    }

    /** Hands the price back — unassigning before deployment costs nothing. */
    refund(itemId: string, qty = 1): void {
        const price = this.priceOf(itemId, qty);
        if (price) this.inventory.add(price.itemId ?? DOLLAR, price.qty ?? 0);
    }
}

export function describeEquipFailure(failure: EquipFailure): string {
    switch (failure) {
        case 'none':
            return '';
        case 'unknownItem':
            return 'No such item';
        case 'notInShop':
            return 'Not for sale';
        case 'playerLevelTooLow':
            return 'Locked at your level';
        case 'cannotAfford':
            return 'Not enough money';
    }
}
