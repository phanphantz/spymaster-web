import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadTables } from './load';
import { nodeReader } from './nodeReader';
import { mergeLayers } from './merge';
import { validate } from './validate';
import { gridToRows } from './sheetJson';
import { schemaFor } from './schemas';
import { coerceRows } from './coerce';

const DATA_ROOT = resolve(__dirname, '../../public/data');
const reader = nodeReader(DATA_ROOT);

/** Every test loads explicitly, so none of them touch the network or the sheet. */
const loadSeed = (layers: Parameters<typeof loadTables>[0]) =>
    loadTables({ reader, ...layers });

describe('seed data', () => {
    it('loads and every reference resolves', async () => {
        const data = await loadSeed({ layers: ['seed'] });

        const errors = data.issues.filter((issue) => issue.severity === 'error');
        expect(errors.map((issue) => issue.message)).toEqual([]);
    });

    it('is playable on its own, with no sheet layer present', async () => {
        const data = await loadSeed({ layers: ['seed'] });

        // The three things the loop cannot start without.
        expect(data.tables.MissionFeed.rows.length).toBeGreaterThan(0);
        expect(data.tables.Employment.rows.length).toBeGreaterThan(0);
        expect(data.tables.AgentData.rows.length).toBeGreaterThanOrEqual(8);

        // Every mission must reach a Gate that names its slots, and end in a tier
        // whose Gate is empty — otherwise a loadout could resolve to nothing.
        for (const mission of data.tables.Mission.rows) {
            const startGate = data.tables.Gate.get(mission.gateId);
            expect(startGate?.slotReqIds?.length, `${mission.missionId} start gate`).toBeGreaterThan(0);

            const tiers = data.tables.Outcome.getMany(mission.outcomes);
            expect(tiers.length, `${mission.missionId} outcomes`).toBeGreaterThanOrEqual(2);

            const fallback = tiers[tiers.length - 1];
            expect(data.tables.Gate.get(fallback.gateId), `${mission.missionId} fallback`).toBeUndefined();
        }
    });

    it('prices every shop item in dollars', async () => {
        const data = await loadSeed({ layers: ['seed'] });

        const shopItems = data.tables.Item.rows.filter((item) => item.isInShop);
        expect(shopItems.length).toBeGreaterThan(20);

        for (const item of shopItems) {
            expect(item.priceItemId, item.itemId).toBe('dollar');
            expect(item.priceItemQty ?? 0, item.itemId).toBeGreaterThan(0);
        }
    });

    it('coerces sheet strings into numbers and booleans', async () => {
        const data = await loadSeed({ layers: ['seed'] });

        const agent = data.tables.AgentData.get('agentAngel');
        expect(typeof agent?.int).toBe('number');
        expect(typeof agent?.baseHealth).toBe('number');
        expect(Array.isArray(agent?.tags)).toBe(true);

        const mission = data.tables.Mission.rows[0];
        expect(typeof mission.isDeclinable).toBe('boolean');
    });
});

describe('data layers', () => {
    it('lets a mock patch one field without disturbing the rest of the row', async () => {
        const base = await loadSeed({ layers: ['seed'] });
        const patched = await loadSeed({
            layers: ['seed'],
            overrides: { Item: [{ itemId: 'toolPicklockSet', priceItemQty: 999 }] },
        });

        const before = base.tables.Item.get('toolPicklockSet')!;
        const after = patched.tables.Item.get('toolPicklockSet')!;

        expect(after.priceItemQty).toBe(999);
        // Everything the patch did not mention survives.
        expect(after.displayName).toBe(before.displayName);
        expect(after.sthEffect).toBe(before.sthEffect);
        expect(after.tags).toEqual(before.tags);
    });

    it('appends rows a later layer introduces', async () => {
        const data = await loadSeed({
            layers: ['seed'],
            overrides: { Mission: [{ missionId: 'brand_new', displayName: 'Brand New' }] },
        });

        expect(data.tables.Mission.get('brand_new')?.displayName).toBe('Brand New');
        expect(data.tables.Mission.rows.length).toBe(16);
    });

    it('keeps the earliest layer position for a row it later patches', () => {
        const merged = mergeLayers([
            { Mission: [{ missionId: 'a' }, { missionId: 'b' }] },
            { Mission: [{ missionId: 'b', displayName: 'patched' }, { missionId: 'c' }] },
        ]);

        expect(merged.Mission.map((row) => row.missionId)).toEqual(['a', 'b', 'c']);
        expect(merged.Mission[1].displayName).toBe('patched');
    });

    it('reports a missing layer instead of throwing', async () => {
        const data = await loadSeed({ layers: ['seed', 'mock:does-not-exist'] });

        expect(data.layers[1].error).toContain('does-not-exist');
        // The seed layer still loaded, so the game is still playable.
        expect(data.tables.Mission.rows.length).toBeGreaterThan(0);
    });

    it('survives a sheet layer that is absent', async () => {
        const data = await loadSeed({ layers: ['seed', 'sheet'] });

        expect(data.tables.Mission.rows.length).toBeGreaterThan(0);
    });

    it('applies the heist mock over seed without redefining agents or items', async () => {
        const data = await loadSeed({ layers: ['seed', 'mock:heist-test'] });

        expect(data.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
        expect(data.tables.Mission.get('heist')?.displayName).toBe('Vault Job');
        // The mock only names a mission, gates, outcomes, incidents and the feed.
        expect(data.tables.AgentData.rows.length).toBe(20);
        expect(data.tables.Item.rows.length).toBeGreaterThan(40);
        // It repoints the feed at its own pool.
        expect(data.tables.MissionFeed.get('feed_prototype')?.pools?.[0]?.poolId)
            .toBe('pool_heist_test');
    });
});

describe('validator', () => {
    it('catches every dangling reference in the broken-refs mock', async () => {
        const data = await loadSeed({ layers: ['seed', 'mock:broken-refs'] });

        const errors = data.issues.filter((issue) => issue.severity === 'error');
        const values = errors.map((issue) => issue.value);

        expect(values).toContain('gate_that_does_not_exist');
        expect(values).toContain('outcome_that_does_not_exist');
        expect(values).toContain('nowhere');
        expect(values).toContain('slot_that_does_not_exist');
        expect(values).toContain('item_that_does_not_exist');
        expect(values).toContain('skill_that_does_not_exist');
    });

    it('stays quiet about a tab nobody has authored yet', () => {
        // Habit has no rows, so an agent's habits cannot be checked against it.
        const issues = validate(
            mergeLayers([{ AgentData: [{ characterId: 'x', habits: ['unknownHabit'] }] }]),
        );

        expect(issues.filter((issue) => issue.target === 'Habit')).toEqual([]);
    });
});

describe('sheet grid parsing', () => {
    it('folds repeated single columns into an array', () => {
        const rows = gridToRows([
            ['itemId', 'tags', 'tags', 'tags'],
            ['knife', 'lethal', '', 'stealthy'],
        ]);

        expect(rows).toEqual([{ itemId: 'knife', tags: ['lethal', 'stealthy'] }]);
    });

    it('folds a declared column group into an array of objects', () => {
        const rows = gridToRows(
            [
                ['gateId', 'reqItemId', 'reqItemQty', 'reqItemId', 'reqItemQty'],
                ['g1', 'dollar', '100', 'melKatana', '1'],
            ],
            schemaFor('Gate'),
        );

        expect(rows[0].reqItems).toEqual([
            { itemId: 'dollar', qty: '100' },
            { itemId: 'melKatana', qty: '1' },
        ]);
    });

    it('omits blank cells entirely, so a sparse row is a patch', () => {
        const rows = gridToRows([
            ['missionId', 'displayName', 'hint'],
            ['heist', '', 'quiet'],
        ]);

        expect(rows[0]).toEqual({ missionId: 'heist', hint: 'quiet' });
        expect('displayName' in rows[0]).toBe(false);
    });

    it('reads a transposed pool tab', () => {
        const rows = gridToRows(
            [
                ['poolId', 'pool_a', 'pool_b'],
                ['entryId', 'heist', 'courier_run'],
                ['weight', '7', '14'],
                ['entryId', 'silent_kill', ''],
                ['weight', '3', ''],
            ],
            schemaFor('MissionPool'),
        );

        expect(rows).toEqual([
            {
                poolId: 'pool_a',
                entries: [
                    { entryId: 'heist', weight: '7' },
                    { entryId: 'silent_kill', weight: '3' },
                ],
            },
            { poolId: 'pool_b', entries: [{ entryId: 'courier_run', weight: '14' }] },
        ]);
    });

    it('strips a type tag from a column name', () => {
        const rows = gridToRows([
            ['missionId', 'difficultyLevel (int)', 'tags[]'],
            ['heist', '3', 'quiet'],
        ]);

        expect(rows[0]).toEqual({ missionId: 'heist', difficultyLevel: '3', tags: 'quiet' });
    });
});

describe('coercion', () => {
    it('turns sheet strings into the types the row declares', () => {
        const [row] = coerceRows<Record<string, unknown>>('Mission', [
            { missionId: 'heist', difficultyLevel: '3', isDeclinable: 'TRUE', outcomes: 'a,b' },
        ]);

        expect(row).toEqual({
            missionId: 'heist',
            difficultyLevel: 3,
            isDeclinable: true,
            outcomes: ['a', 'b'],
        });
    });

    it('leaves already-typed values alone', () => {
        const [row] = coerceRows<Record<string, unknown>>('Mission', [
            { missionId: 'heist', difficultyLevel: 3, isDeclinable: false, outcomes: ['a'] },
        ]);

        expect(row).toEqual({
            missionId: 'heist',
            difficultyLevel: 3,
            isDeclinable: false,
            outcomes: ['a'],
        });
    });

    it('keeps isConcealed a vocabulary value rather than reading it as a boolean', () => {
        const [row] = coerceRows<Record<string, unknown>>('Item', [
            { itemId: 'knife', isConcealed: 'canHide', type: 'closeRangeWeapon' },
        ]);

        expect(row.isConcealed).toBe('canHide');
        // type is a list on Item and a single value everywhere else.
        expect(row.type).toEqual(['closeRangeWeapon']);
    });

    it('coerces inside a group entry', () => {
        const [row] = coerceRows<Record<string, unknown>>('Gate', [
            { gateId: 'g1', reqItems: [{ itemId: 'dollar', qty: '100' }] },
        ]);

        expect(row.reqItems).toEqual([{ itemId: 'dollar', qty: 100 }]);
    });
});
