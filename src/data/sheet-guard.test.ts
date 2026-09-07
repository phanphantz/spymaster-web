import { describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadTables } from './load';
import { nodeReader } from './nodeReader';
import { DOLLAR } from '../engine/types';

/**
 * The gate between the spreadsheet and the deployed site.
 *
 * `sync-gamedata.yml` runs the test suite after pulling the workbook and only commits if it
 * passes, so these are what stand between a hand-edited sheet and a broken page. They are skipped
 * when nothing has been synced, which is the normal state of a fresh checkout.
 */

const DATA_ROOT = resolve(__dirname, '../../public/data');

async function syncedTabs(): Promise<string[]> {
    try {
        const files = await readdir(resolve(DATA_ROOT, 'sheet'));
        return files.filter((file) => file.endsWith('.json'));
    } catch {
        return [];
    }
}

describe('synced sheet data', async () => {
    const tabs = await syncedTabs();

    it.skipIf(tabs.length === 0)('merges over seed without dangling a single reference', async () => {
        const data = await loadTables({ layers: ['seed', 'sheet'], reader: nodeReader(DATA_ROOT) });

        const errors = data.issues.filter((issue) => issue.severity === 'error');
        // Grouped, because one bad column produces one error per row and the raw list is unreadable.
        const grouped = new Map<string, Set<string>>();
        for (const issue of errors) {
            const key = `${issue.sheet}.${issue.path} -> ${issue.target}`;
            const values = grouped.get(key) ?? new Set();
            values.add(issue.value);
            grouped.set(key, values);
        }

        const summary = [...grouped].map(
            ([key, values]) => `${key}: ${[...values].slice(0, 5).join(', ')}`,
        );

        expect(summary).toEqual([]);
    });

    it.skipIf(tabs.length === 0)('leaves every shop item priced in something that exists', async () => {
        const data = await loadTables({ layers: ['seed', 'sheet'], reader: nodeReader(DATA_ROOT) });

        // Money is an Item, so a price that names no Item is a shop where nothing is affordable —
        // and nothing about that failure is visible in the UI.
        const broken = data.tables.Item.rows
            .filter((item) => item.isInShop)
            .filter((item) => !data.tables.Item.get(item.priceItemId ?? DOLLAR))
            .map((item) => `${item.itemId} priced in "${item.priceItemId}"`);

        expect(broken).toEqual([]);
    });

    it.skipIf(tabs.length === 0)('still feeds missions after the merge', async () => {
        const data = await loadTables({ layers: ['seed', 'sheet'], reader: nodeReader(DATA_ROOT) });

        // A sheet that empties the Feed or its pool leaves a World Map nothing ever arrives on.
        expect(data.tables.MissionFeed.rows.length).toBeGreaterThan(0);
        for (const feed of data.tables.MissionFeed.rows) {
            for (const draw of feed.pools ?? []) {
                const pool = data.tables.MissionPool.get(draw.poolId);
                expect(pool?.entries?.length ?? 0, `pool ${draw.poolId}`).toBeGreaterThan(0);
            }
        }
    });
});
