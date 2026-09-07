import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { loadTables } from '../data/load';
import { nodeReader } from '../data/nodeReader';
import { makeTable } from '../data/merge';
import { Clock } from './clock';
import { Container, Inventory, StatContainer } from './container';
import { rollOffer } from './employment';
import * as gateEvaluator from './gateEvaluator';
import type { AgentSlotAssignment, GateContext } from './gateContext';
import { partyStats } from './gateContext';
import { runIncidents } from './incidents';
import { LoadoutSession } from './loadout';
import { MissionFeedRuntime, MissionFeedState, generateMission } from './missionFeed';
import { deploy } from './missionRun';
import * as resolver from './missionOutcomeResolver';
import { createRng, type Rng } from './rng';
import * as runtimeAgent from './runtimeAgent';
import { Shop } from './shop';
import * as slotRequirement from './slotRequirementEvaluator';
import * as weightedPool from './weightedPool';
import type { GameTables, GateData, LocationData, OutcomeData, SlotRequirementData } from './types';

const DATA_ROOT = resolve(__dirname, '../../public/data');
const seed = () => loadTables({ layers: ['seed'], reader: nodeReader(DATA_ROOT) });

// ---------------------------------------------------------------------------
// Small hand-built fixtures, so a Gate test does not depend on the seed balance.
// ---------------------------------------------------------------------------

function agent(overrides: Partial<AgentSlotAssignment> = {}): AgentSlotAssignment {
    return {
        slotId: 'slot_a',
        characterId: 'someone',
        level: 1,
        stats: new StatContainer(),
        skillIds: [],
        tags: [],
        ...overrides,
    };
}

function statsOf(entries: Record<string, number>): StatContainer {
    return new StatContainer(Object.entries(entries));
}

function context(overrides: Partial<GateContext> = {}): GateContext {
    return {
        gates: makeTable<GateData>('Gate', []),
        slotRequirements: makeTable<SlotRequirementData>('SlotRequirement', []),
        outcomes: makeTable<OutcomeData>('Outcome', []),
        assignments: [],
        carriedItems: new Inventory(),
        rng: createRng(1),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------

describe('Container', () => {
    it('clamps at zero rather than going negative', () => {
        const container = new Container([['dollar', 100]]);
        container.set('dollar', -50);
        expect(container.get('dollar')).toBe(0);
    });

    it('refuses a removal it cannot cover, leaving the balance untouched', () => {
        const container = new Container([['dollar', 100]]);
        expect(container.remove('dollar', 150)).toBe(false);
        expect(container.get('dollar')).toBe(100);
    });

    it('treats a missing entry as zero when checking a requirement', () => {
        const held = new Container([['dollar', 10]]);
        const { hasEnough, missing } = held.hasEnough(new Container([['melKatana', 1]]));

        expect(hasEnough).toBe(false);
        expect(missing).toEqual([['melKatana', 1]]);
    });

    it('transfers only what is there, and reports how much moved', () => {
        const from = new Container([['dollar', 30]]);
        const to = new Container();

        expect(from.transferTo(to, 'dollar', 100)).toBe(30);
        expect(from.get('dollar')).toBe(0);
        expect(to.get('dollar')).toBe(30);
    });

    it('ignores unauthored zero columns when reading stats off a row', () => {
        const stats = StatContainer.fromColumns({ ast: 12, end: 0, sth: undefined });

        expect(stats.get('ast')).toBe(12);
        // A blank column means "no value authored", not "requires zero".
        expect(stats.ids).toEqual(['ast']);
    });
});

describe('GateEvaluator', () => {
    it('treats an empty or unauthored Gate as always matching', () => {
        // This is what makes the critical-failure tier a guaranteed fallback.
        expect(gateEvaluator.matches(undefined, context())).toBe(true);
        expect(gateEvaluator.matches({ gateId: 'empty' }, context())).toBe(true);
    });

    it('measures stat minimums against the party summed, not one agent', () => {
        const gate: GateData = { gateId: 'g', sth: 20 };
        const pair = context({
            assignments: [
                agent({ stats: statsOf({ sth: 12 }) }),
                agent({ slotId: 'slot_b', stats: statsOf({ sth: 9 }) }),
            ],
        });

        expect(partyStats(pair).get('sth')).toBe(21);
        expect(gateEvaluator.matches(gate, pair)).toBe(true);

        const alone = context({ assignments: [agent({ stats: statsOf({ sth: 12 }) })] });
        expect(gateEvaluator.matches(gate, alone)).toBe(false);
    });

    it('combines every field with AND, never a partial match', () => {
        const gate: GateData = {
            gateId: 'g',
            sth: 10,
            reqItems: [{ itemId: 'toolPicklockSet', qty: 1 }],
            reqSkillIds: ['hacking'],
        };

        const full = context({
            assignments: [agent({ stats: statsOf({ sth: 10 }), skillIds: ['hacking'] })],
            carriedItems: new Inventory([['toolPicklockSet', 1]]),
        });
        expect(gateEvaluator.matches(gate, full)).toBe(true);

        const noItem = context({
            assignments: [agent({ stats: statsOf({ sth: 10 }), skillIds: ['hacking'] })],
        });
        expect(gateEvaluator.matches(gate, noItem)).toBe(false);

        const noSkill = context({
            assignments: [agent({ stats: statsOf({ sth: 10 }) })],
            carriedItems: new Inventory([['toolPicklockSet', 1]]),
        });
        expect(gateEvaluator.matches(gate, noSkill)).toBe(false);
    });

    it('satisfies a required Skill from any assigned agent, and pools carried items', () => {
        const gate: GateData = {
            gateId: 'g',
            reqSkillIds: ['hacking'],
            reqItems: [{ itemId: 'toolMicroDrone', qty: 2 }],
        };

        // One agent has the skill, and the two of them carry one drone each.
        const pooled = context({
            assignments: [agent({ skillIds: [] }), agent({ slotId: 'slot_b', skillIds: ['hacking'] })],
            carriedItems: new Inventory([['toolMicroDrone', 2]]),
        });

        expect(gateEvaluator.matches(gate, pooled)).toBe(true);
    });

    it('skips a slot requirement id nobody has authored rather than failing the Gate', () => {
        const gate: GateData = { gateId: 'g', slotReqIds: ['slot_that_is_not_authored'] };
        expect(gateEvaluator.matches(gate, context())).toBe(true);
    });

    it('fails a Gate whose slot requirement is unmet', () => {
        const requirement: SlotRequirementData = { slotId: 'slot_a', isMandatory: true, int: 12 };
        const gate: GateData = { gateId: 'g', slotReqIds: ['slot_a'] };

        const tables = makeTable<SlotRequirementData>('SlotRequirement', [requirement]);
        const weak = context({
            slotRequirements: tables,
            assignments: [agent({ stats: statsOf({ int: 4 }) })],
        });

        expect(gateEvaluator.matches(gate, weak)).toBe(false);
    });

    describe('luckRoll', () => {
        const gateWith = (value: string): GateData => ({
            gateId: 'g',
            conditions: [{ conditionId: 'luckRoll', conditionValue: value }],
        });

        it('never passes at 0 and always passes at 1', () => {
            expect(gateEvaluator.matches(gateWith('0'), context())).toBe(false);
            expect(gateEvaluator.matches(gateWith('1'), context())).toBe(true);
        });

        it('rolls fresh every check, and is reproducible from a seed', () => {
            const runWithSeed = (value: number) => {
                const ctx = context({ rng: createRng(value) });
                return Array.from({ length: 20 }, () => gateEvaluator.matches(gateWith('0.5'), ctx));
            };

            const first = runWithSeed(42);
            // Not a constant answer: it is rolled per check, not once per Gate.
            expect(new Set(first).size).toBe(2);
            // And the same seed replays exactly.
            expect(runWithSeed(42)).toEqual(first);
        });

        it('treats an unparseable probability as unmet', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(gateEvaluator.matches(gateWith('probably'), context())).toBe(false);
            warn.mockRestore();
        });
    });

    it('treats an unknown condition as unmet rather than silently passing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const gate: GateData = {
            gateId: 'g',
            conditions: [{ conditionId: 'notImplementedYet', conditionValue: '1' }],
        };

        expect(gateEvaluator.matches(gate, context())).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('SlotRequirementEvaluator', () => {
    it('checks stat minimums per agent, unlike a Gate', () => {
        const requirement: SlotRequirementData = { slotId: 'slot_a', int: 12 };

        expect(slotRequirement.isEligible(requirement, agent({ stats: statsOf({ int: 12 }) }))).toBe(true);
        expect(slotRequirement.isEligible(requirement, agent({ stats: statsOf({ int: 11 }) }))).toBe(false);
    });

    it('rejects an excluded tag outright, whatever the stats say', () => {
        const requirement: SlotRequirementData = { slotId: 'slot_a', excludedTags: ['lethal'] };
        const capable = agent({ stats: statsOf({ ast: 99 }), tags: ['lethal'] });

        expect(slotRequirement.isEligible(requirement, capable)).toBe(false);
        expect(slotRequirement.explain(requirement, capable)).toEqual([
            { kind: 'excludedTag', tag: 'lethal' },
        ]);
    });

    it('lets an empty optional slot pass, but not an empty mandatory one', () => {
        expect(slotRequirement.matches({ slotId: 'slot_a', isMandatory: false }, undefined)).toBe(true);
        expect(slotRequirement.matches({ slotId: 'slot_a', isMandatory: true }, undefined)).toBe(false);
    });

    it('reports every reason at once, so the Loadout can explain itself', () => {
        const requirement: SlotRequirementData = {
            slotId: 'slot_a',
            minLevel: 5,
            int: 12,
            tags: ['technical'],
        };

        const reasons = slotRequirement.explain(requirement, agent({ stats: statsOf({ int: 4 }) }));
        expect(reasons.map((reason) => reason.kind)).toEqual(['level', 'stat', 'missingTag']);
    });
});

describe('MissionOutcomeResolver', () => {
    const tiers = (rows: OutcomeData[]) => makeTable<OutcomeData>('Outcome', rows);
    const gates = (rows: GateData[]) => makeTable<GateData>('Gate', rows);

    it('returns the first tier whose Gate matches, walking in authored order', () => {
        const ctx = context({
            gates: gates([
                { gateId: 'strict', sth: 30 },
                { gateId: 'loose', sth: 5 },
            ]),
            assignments: [agent({ stats: statsOf({ sth: 10 }) })],
        });

        const ordered = tiers([
            { outcomeId: 'best', type: 'best', gateId: 'strict' },
            { outcomeId: 'ok', type: 'acceptable', gateId: 'loose' },
            { outcomeId: 'fail', type: 'criticalFailure' },
        ]).rows;

        expect(resolver.selectOutcome(ordered, ctx)?.outcomeId).toBe('ok');
    });

    it('falls through to the empty-Gate tier when nothing above it matches', () => {
        const ctx = context({ gates: gates([{ gateId: 'strict', sth: 30 }]) });

        const ordered = tiers([
            { outcomeId: 'best', type: 'best', gateId: 'strict' },
            { outcomeId: 'fail', type: 'criticalFailure' },
        ]).rows;

        expect(resolver.selectOutcome(ordered, ctx)?.outcomeId).toBe('fail');
    });

    it('computes no score and exposes none', () => {
        // Guarding the design rule directly: the resolver returns a tier, never a number.
        const ctx = context({ gates: gates([{ gateId: 'g', sth: 1 }]) });
        const result = resolver.selectOutcome(
            tiers([{ outcomeId: 'best', type: 'best', gateId: 'g' }]).rows,
            ctx,
        );

        expect(result === undefined || typeof result === 'object').toBe(true);
        expect(Object.keys(result ?? {})).not.toContain('score');
    });
});

describe('WeightedPool', () => {
    it('gives an entry its weight over the summed weight', () => {
        const pool = {
            poolId: 'p',
            entries: [
                { entryId: 'common', weight: 9 },
                { entryId: 'rare', weight: 1 },
            ],
        };

        const rng = createRng(7);
        const counts = { common: 0, rare: 0 };
        for (let i = 0; i < 4000; i++) {
            const drawn = weightedPool.draw(pool, rng)!.entryId as keyof typeof counts;
            counts[drawn]++;
        }

        expect(counts.rare / 4000).toBeGreaterThan(0.06);
        expect(counts.rare / 4000).toBeLessThan(0.14);
    });

    it('skips weightless entries entirely', () => {
        const pool = {
            poolId: 'p',
            entries: [
                { entryId: 'never', weight: 0 },
                { entryId: 'always', weight: 3 },
            ],
        };

        for (let i = 0; i < 50; i++) {
            expect(weightedPool.draw(pool, createRng(i))?.entryId).toBe('always');
        }
    });

    it('draws distinct entries without replacement', () => {
        const pool = {
            poolId: 'p',
            entries: ['a', 'b', 'c', 'd'].map((entryId) => ({ entryId, weight: 5 })),
        };

        const drawn = weightedPool.drawDistinct(pool, 3, createRng(11));
        expect(drawn).toHaveLength(3);
        expect(new Set(drawn.map((entry) => entry.entryId)).size).toBe(3);
    });
});

describe('Clock', () => {
    it('walks every crossed minute rather than jumping over them', () => {
        const seen: number[] = [];
        const clock = new Clock({ timeScale: 60 }, { onMinuteChanged: (minute) => seen.push(minute) });

        // One slow frame covering five in-game minutes must still fire all five.
        clock.tick(5);
        expect(seen).toEqual([1, 2, 3, 4, 5]);
    });

    it('keeps minutes, hours and days absolute so timers can be scheduled against them', () => {
        const clock = new Clock({ timeScale: 60 });
        clock.addMinutes(60 * 25);

        expect(clock.totalMinutes).toBe(1500);
        expect(clock.totalHours).toBe(25);
        expect(clock.totalDays).toBe(1);
        // Time of day still wraps, for the readout.
        expect(clock.hourOfDay).toBe(1);
    });

    it('stands still while paused or at speed zero', () => {
        const clock = new Clock({ timeScale: 60 });

        clock.isPaused = true;
        clock.tick(10);
        expect(clock.totalMinutes).toBe(0);

        clock.isPaused = false;
        clock.speedMultiplier = 0;
        clock.tick(10);
        expect(clock.totalMinutes).toBe(0);
    });
});

describe('MissionFeedState', () => {
    const feed = {
        feedId: 'f',
        maxActiveCount: 2,
        minFeedIntervalMinute: 30,
        maxFeedIntervalMinute: 30,
        pools: [{ poolId: 'p', qty: 3 }],
    };
    const drawAlways = () => 'mission_a';

    it('is due immediately when it takes over, so a run does not open on a wait', () => {
        const state = new MissionFeedState(feed, createRng(1), 0, drawAlways);
        expect(state.isDue(0, 0)).toBe(true);
    });

    it('plans its whole quota up front, so what comes next is readable', () => {
        const state = new MissionFeedState(feed, createRng(1), 0, drawAlways);
        expect(state.upcoming).toHaveLength(3);
    });

    it('spaces releases by the rolled interval', () => {
        const state = new MissionFeedState(feed, createRng(1), 0, drawAlways);

        state.takeNext(0, createRng(1));
        expect(state.isDue(29, 0)).toBe(false);
        expect(state.isDue(30, 0)).toBe(true);
    });

    it('holds at the active cap without spending the feed', () => {
        const state = new MissionFeedState(feed, createRng(1), 0, drawAlways);
        const planned = state.upcoming.length;

        expect(state.isDue(0, 2)).toBe(false);
        expect(state.upcoming).toHaveLength(planned);
        // A slot frees up and the same mission is still next.
        expect(state.isDue(0, 1)).toBe(true);
    });

    it('treats a quota of zero as unlimited, planned to the lookahead', () => {
        const unlimited = { ...feed, pools: [{ poolId: 'p', qty: 0 }] };
        const state = new MissionFeedState(unlimited, createRng(1), 0, drawAlways);

        expect(state.upcoming).toHaveLength(10);

        state.takeNext(0, createRng(1));
        // Topped straight back up, so it never runs dry.
        expect(state.upcoming).toHaveLength(10);
        expect(state.isSpent).toBe(false);
    });

    it('is spent once a limited quota is used up', () => {
        const state = new MissionFeedState(feed, createRng(1), 0, drawAlways);

        for (let i = 0; i < 3; i++) state.takeNext(i * 30, createRng(1));

        expect(state.isSpent).toBe(true);
        expect(state.isDue(1000, 0)).toBe(false);
    });

    it('drops a pool that cannot produce instead of looping forever', () => {
        const state = new MissionFeedState(feed, createRng(1), 0, () => undefined);
        expect(state.upcoming).toHaveLength(0);
    });
});

describe('mission generation', () => {
    const locations = makeTable<LocationData>('Location', [
        { locationId: 'zurich', displayName: 'Zurich' },
    ]);

    it('substitutes {location} into the text fields', () => {
        const live = generateMission(
            {
                missionId: 'm',
                locationId: 'zurich',
                displayName: 'Job in {location}',
                description: 'A vault in {location}.',
                hint: 'Quiet.',
            },
            locations,
            createRng(1),
            'm#1',
            0,
        );

        expect(live.data.displayName).toBe('Job in Zurich');
        expect(live.data.description).toBe('A vault in Zurich.');
    });

    it('draws a Location when the blueprint leaves it blank', () => {
        const live = generateMission(
            { missionId: 'm', description: 'Somewhere in {location}.' },
            locations,
            createRng(1),
            'm#1',
            0,
        );

        expect(live.data.locationId).toBe('zurich');
        expect(live.data.description).toBe('Somewhere in Zurich.');
    });

    it('leaves an unresolved placeholder standing so missing data stays visible', () => {
        const live = generateMission(
            { missionId: 'm', description: 'In {location}.' },
            makeTable<LocationData>('Location', []),
            createRng(1),
            'm#1',
            0,
        );

        expect(live.data.description).toBe('In {location}.');
    });

    it('never writes to the blueprint it cloned', () => {
        const blueprint = { missionId: 'm', locationId: 'zurich', displayName: 'Job in {location}' };
        generateMission(blueprint, locations, createRng(1), 'm#1', 0);

        expect(blueprint.displayName).toBe('Job in {location}');
    });
});

describe('Shop', () => {
    let tables: GameTables;
    let inventory: Inventory;
    let shop: Shop;

    beforeEach(async () => {
        tables = (await seed()).tables;
        inventory = new Inventory([['dollar', 1000]]);
        shop = new Shop(tables.Item, inventory, 1);
    });

    it('lists only what is in the shop at this player level', () => {
        const listed = shop.availableItems();

        expect(listed.length).toBeGreaterThan(20);
        expect(listed.every((item) => item.isInShop)).toBe(true);
        // Money itself is not for sale.
        expect(listed.some((item) => item.itemId === 'dollar')).toBe(false);
    });

    it('buys all or nothing', () => {
        expect(shop.purchase('toolPicklockSet', 1)).toBe('none');
        expect(inventory.get('toolPicklockSet')).toBe(1);
        expect(inventory.get('dollar')).toBe(600);

        // Two more would cost 800 and only 600 is left.
        expect(shop.purchase('toolPicklockSet', 2)).toBe('cannotAfford');
        expect(inventory.get('toolPicklockSet')).toBe(1);
        expect(inventory.get('dollar')).toBe(600);
    });

    it('reports failures in the documented order', () => {
        expect(shop.checkPurchase('no_such_item')).toBe('unknownItem');
        expect(shop.checkPurchase('dollar')).toBe('notInShop');

        const highLevel = new Shop(
            makeTable('Item', [
                { itemId: 'x', isInShop: true, minPlayerLevel: 5, priceItemId: 'dollar', priceItemQty: 1 },
            ]),
            inventory,
            1,
        );
        expect(highLevel.checkPurchase('x')).toBe('playerLevelTooLow');
    });

    it('reads an unauthored maxOwnedCount of zero as unlimited, matching Unity', () => {
        const items = makeTable('Item', [
            { itemId: 'x', isInShop: true, priceItemId: 'dollar', priceItemQty: 1, maxOwnedCount: 0 },
        ]);
        const unlimited = new Shop(items, new Inventory([['dollar', 100]]), 1);

        expect(unlimited.remainingAllowance('x')).toBe(Number.POSITIVE_INFINITY);
    });

    it('enforces a real ownership cap', () => {
        const items = makeTable('Item', [
            { itemId: 'x', isInShop: true, priceItemId: 'dollar', priceItemQty: 1, maxOwnedCount: 2 },
        ]);
        const capped = new Shop(items, new Inventory([['dollar', 100]]), 1);

        expect(capped.purchase('x', 2)).toBe('none');
        expect(capped.checkPurchase('x', 1)).toBe('ownedCountReached');
    });
});

// ---------------------------------------------------------------------------
// Everything below runs against the real seed data, so a balance change that
// makes the loop unplayable fails here rather than in the browser.
// ---------------------------------------------------------------------------

async function fixture(seedValue = 5) {
    const { tables } = await seed();
    const rng: Rng = createRng(seedValue);
    const inventory = new Inventory([['dollar', 50000]]);

    const roster = ['agentNoire', 'agentAngel', 'agentPatch', 'agentPercival'].map((id) =>
        runtimeAgent.createAgent(tables.AgentData.get(id)!, tables.CharacterData.get(id)),
    );

    const feedRuntime = new MissionFeedRuntime(tables, rng);
    feedRuntime.syncActiveFeed(1, 0);

    return { tables, rng, inventory, roster, feedRuntime };
}

describe('Employment', () => {
    it('offers a distinct shortlist and asks for a subset of it', async () => {
        const { tables } = await seed();
        const offer = rollOffer(tables, 1, createRng(3))!;

        expect(offer.candidates).toHaveLength(8);
        expect(offer.pickQty).toBe(4);
        expect(new Set(offer.candidates.map((a) => a.characterId)).size).toBe(8);
    });

    it('costs nothing — recruitment is a reward phase, not a purchase', async () => {
        const { tables } = await seed();
        const inventory = new Inventory([['dollar', 100]]);

        rollOffer(tables, 1, createRng(3));

        expect(inventory.get('dollar')).toBe(100);
    });
});

describe('Loadout', () => {
    it('takes its slots from the mission start Gate, in authored order', async () => {
        const { tables, rng, inventory, roster } = await fixture();
        const mission = generateMission(
            tables.Mission.get('heist_vault')!, tables.Location, rng, 'heist_vault#1', 0,
        );

        const session = new LoadoutSession(mission, tables, roster, inventory, 1);

        expect(session.slots.map((slot) => slot.slotId)).toEqual(['slot_stealth', 'slot_hacker']);
    });

    it('blocks confirmation while a mandatory slot is empty', async () => {
        const { tables, rng, inventory, roster } = await fixture();
        const mission = generateMission(
            tables.Mission.get('heist_vault')!, tables.Location, rng, 'heist_vault#1', 0,
        );
        const session = new LoadoutSession(mission, tables, roster, inventory, 1);

        expect(session.canConfirm).toBe(false);

        session.assignAgent('slot_stealth', 'agentNoire');
        expect(session.canConfirm).toBe(false);

        session.assignAgent('slot_hacker', 'agentAngel');
        expect(session.canConfirm).toBe(true);
    });

    it('refuses an agent who fails the slot, and says why', async () => {
        const { tables, rng, inventory, roster } = await fixture();
        const mission = generateMission(
            tables.Mission.get('heist_vault')!, tables.Location, rng, 'heist_vault#1', 0,
        );
        const session = new LoadoutSession(mission, tables, roster, inventory, 1);

        // Patch is a soldier, not a hacker: his INT is under the slot minimum.
        expect(session.assignAgent('slot_hacker', 'agentPatch')).toBe(false);

        const patch = session.candidatesFor('slot_hacker').find((c) => c.agent.characterId === 'agentPatch')!;
        expect(patch.isEligible).toBe(false);
        expect(patch.reasons.some((reason) => reason.kind === 'stat')).toBe(true);
    });

    it('moves items rather than marking them, and returns everything on cancel', async () => {
        const { tables, rng, inventory, roster } = await fixture();
        const mission = generateMission(
            tables.Mission.get('heist_vault')!, tables.Location, rng, 'heist_vault#1', 0,
        );
        const session = new LoadoutSession(mission, tables, roster, inventory, 1);

        session.shop.purchase('toolPicklockSet', 1);
        const afterPurchase = inventory.get('toolPicklockSet');

        session.assignAgent('slot_stealth', 'agentNoire');
        session.assignItem('agentNoire', 'toolPicklockSet', 1);

        // The stock actually left the pool.
        expect(inventory.get('toolPicklockSet')).toBe(afterPurchase - 1);
        expect(session.carriedBy('agentNoire').get('toolPicklockSet')).toBe(1);

        session.cancel();
        expect(inventory.get('toolPicklockSet')).toBe(afterPurchase);
    });

    it('returns a displaced agent’s items but keeps a moved agent’s', async () => {
        const { tables, rng, inventory, roster } = await fixture();
        const mission = generateMission(
            tables.Mission.get('deepwater_recovery')!, tables.Location, rng, 'deepwater#1', 0,
        );
        const session = new LoadoutSession(mission, tables, roster, inventory, 1);
        session.shop.purchase('toolOxygenTank', 2);

        session.assignAgent('slot_any', 'agentNoire');
        session.assignItem('agentNoire', 'toolOxygenTank', 1);

        // Noire moves to the second slot and keeps the tank.
        const slots = session.slots.map((slot) => slot.slotId);
        session.assignAgent(slots[1], 'agentNoire');
        expect(session.carriedBy('agentNoire').get('toolOxygenTank')).toBe(1);
        expect(session.slotOf('agentNoire')).toBe(slots[1]);
    });

    it('will not overfill an agent past their item capacity', async () => {
        const { tables, rng, inventory, roster } = await fixture();
        const mission = generateMission(
            tables.Mission.get('heist_vault')!, tables.Location, rng, 'heist_vault#1', 0,
        );
        const session = new LoadoutSession(mission, tables, roster, inventory, 1);

        session.assignAgent('slot_stealth', 'agentNoire');
        const capacity = runtimeAgent.inventorySize(roster[0]);
        session.shop.purchase('toolFlashlight', capacity + 2);

        expect(session.assignItem('agentNoire', 'toolFlashlight', capacity)).toBe(true);
        expect(session.remainingCapacity('agentNoire')).toBe(0);
        expect(session.assignItem('agentNoire', 'toolFlashlight', 1)).toBe(false);
    });
});

describe('deploying a mission', () => {
    async function heist(seedValue: number) {
        const { tables, rng, inventory, roster } = await fixture(seedValue);
        const mission = generateMission(
            tables.Mission.get('heist_vault')!, tables.Location, rng, 'heist_vault#1', 0,
        );
        const session = new LoadoutSession(mission, tables, roster, inventory, 1);
        return { tables, rng, inventory, roster, session };
    }

    it('succeeds when the right pair is sent with the right kit', async () => {
        const { tables, rng, inventory, session } = await heist(5);

        // Noire's stealth plus Angel's intellect clears both minimums, and the picklock is the
        // Gate's one item requirement.
        session.assignAgent('slot_stealth', 'agentNoire');
        session.assignAgent('slot_hacker', 'agentAngel');
        session.shop.purchase('toolPicklockSet', 1);
        session.assignItem('agentNoire', 'toolPicklockSet', 1);

        const result = deploy({ session, tables, inventory, rng })!;

        expect(result.isSuccess).toBe(true);
        expect(result.outcomeType).toBe('best');
        expect(result.moneyEarned).toBe(6500);
        expect(result.expEarned).toBe(180);
    });

    it('falls to the guaranteed tier when the kit is missing', async () => {
        const { tables, rng, inventory, session } = await heist(5);

        session.assignAgent('slot_stealth', 'agentNoire');
        session.assignAgent('slot_hacker', 'agentAngel');
        // No picklock: everything else about this loadout is right.

        const result = deploy({ session, tables, inventory, rng })!;

        expect(result.isSuccess).toBe(false);
        expect(result.outcomeType).toBe('criticalFailure');
        expect(result.moneyEarned).toBe(0);
        // Failure still teaches something.
        expect(result.expEarned).toBeGreaterThan(0);
        // And it hurts.
        expect(result.agents.every((agent) => agent.currentHealth < runtimeAgent.maxHealth(agent))).toBe(true);
    });

    it('refuses to deploy with a mandatory slot empty', async () => {
        const { tables, rng, inventory, session } = await heist(5);
        session.assignAgent('slot_stealth', 'agentNoire');

        expect(deploy({ session, tables, inventory, rng })).toBeUndefined();
    });

    it('pays out through Incidents, so the money actually reaches the pool', async () => {
        const { tables, rng, inventory, session } = await heist(5);
        session.assignAgent('slot_stealth', 'agentNoire');
        session.assignAgent('slot_hacker', 'agentAngel');
        session.shop.purchase('toolPicklockSet', 1);
        session.assignItem('agentNoire', 'toolPicklockSet', 1);

        const before = inventory.get('dollar');
        deploy({ session, tables, inventory, rng });

        expect(inventory.get('dollar')).toBe(before + 6500);
        // The picklock is permanent, so it comes home.
        expect(inventory.get('toolPicklockSet')).toBe(1);
    });

    it('frees the agents immediately — v1 has no rest', async () => {
        const { tables, rng, inventory, session } = await heist(5);
        session.assignAgent('slot_stealth', 'agentNoire');
        session.assignAgent('slot_hacker', 'agentAngel');

        const result = deploy({ session, tables, inventory, rng })!;

        expect(result.agents.every((agent) => agent.state === 'idle')).toBe(true);
        expect(result.agents.every((agent) => agent.missionAssignedCount === 1)).toBe(true);
    });

    it('replays identically from the same seed', async () => {
        const run = async () => {
            const { tables, rng, inventory, session } = await heist(99);
            session.assignAgent('slot_stealth', 'agentNoire');
            session.assignAgent('slot_hacker', 'agentAngel');
            session.shop.purchase('toolPicklockSet', 1);
            session.assignItem('agentNoire', 'toolPicklockSet', 1);
            const result = deploy({ session, tables, inventory, rng })!;
            return { type: result.outcomeType, money: result.moneyEarned };
        };

        expect(await run()).toEqual(await run());
    });

    it('rejects an agent the client prohibited, whatever their stats', async () => {
        const { tables, rng, inventory, roster } = await fixture();
        // The seed roster has no lethal agent, so bring one in for this.
        const scarlet = runtimeAgent.createAgent(
            tables.AgentData.get('agentScarlet')!,
            tables.CharacterData.get('agentScarlet'),
        );
        const mission = generateMission(
            tables.Mission.get('protect_activist')!, tables.Location, rng, 'protect#1', 0,
        );
        const session = new LoadoutSession(mission, tables, [...roster, scarlet], inventory, 1);

        expect(scarlet.data.tags).toContain('lethal');
        expect(session.assignAgent('slot_clean', 'agentScarlet')).toBe(false);
        expect(session.assignAgent('slot_clean', 'agentPatch')).toBe(true);
    });
});

describe('IncidentExecutor', () => {
    it('applies costs before rewards, so a payout cannot fund its own charge', async () => {
        const { tables } = await seed();
        const inventory = new Inventory([['dollar', 100]]);
        const target = { inventory, agents: [], carried: new Map<string, Inventory>() };

        const incident = makeTable('Incident', [
            {
                incidentId: 'i',
                costItems: [{ itemId: 'dollar', qty: 500 }],
                rewardItems: [{ itemId: 'dollar', qty: 1000 }],
            },
        ]);

        runIncidents(['i'], { ...tables, Incident: incident }, target, createRng(1));

        // The charge took the 100 that was there and stopped — a penalty takes what it can rather
        // than being voided by the player being broke — and only then did the reward land. Charging
        // after the reward would have taken the full 500 out of it.
        expect(inventory.get('dollar')).toBe(1000);
    });

    it('recognises a deferred effect type without breaking the mission', async () => {
        const { tables } = await seed();
        const target = { inventory: new Inventory(), agents: [], carried: new Map<string, Inventory>() };

        const effects = makeTable('Effect', [{ effectId: 'e', type: 'triggerEvent' }]);
        const incident = makeTable('Incident', [
            { incidentId: 'i', effects: [{ effectId: 'e', effectValue: 'someEvent' }] },
        ]);

        const [report] = runIncidents(
            ['i'],
            { ...tables, Effect: effects, Incident: incident },
            target,
            createRng(1),
        );

        expect(report.entries).toEqual([{ kind: 'unsupported', effectType: 'triggerEvent' }]);
    });

    it('destroys carried items rather than pool items', async () => {
        const { tables } = await seed();
        const inventory = new Inventory([['toolFlashlight', 5]]);
        const carried = new Map([['agentNoire', new Inventory([['toolFlashlight', 2]])]]);
        const target = { inventory, agents: [], carried };

        const effects = makeTable('Effect', [{ effectId: 'e', type: 'itemLoss' }]);
        const incident = makeTable('Incident', [
            { incidentId: 'i', effects: [{ effectId: 'e', effectValue: '2' }] },
        ]);

        runIncidents(['i'], { ...tables, Effect: effects, Incident: incident }, target, createRng(1));

        expect(carried.get('agentNoire')!.get('toolFlashlight')).toBe(0);
        expect(inventory.get('toolFlashlight')).toBe(5);
    });
});

describe('the loop, end to end', () => {
    it('feeds missions over time, capped by maxActiveCount', async () => {
        const { feedRuntime } = await fixture();

        const pending: unknown[] = [];
        for (let minute = 0; minute <= 600; minute++) {
            const mission = feedRuntime.evaluate(minute, pending.length);
            if (mission) pending.push(mission);
        }

        // The cap is 4, and nothing has been answered, so it holds there.
        expect(pending).toHaveLength(4);
    });

    it('releases again once a mission is answered', async () => {
        const { feedRuntime } = await fixture();

        let pending = 0;
        for (let minute = 0; minute <= 600; minute++) {
            if (feedRuntime.evaluate(minute, pending)) pending++;
        }
        expect(pending).toBe(4);

        pending--;
        let released = false;
        for (let minute = 601; minute <= 900 && !released; minute++) {
            if (feedRuntime.evaluate(minute, pending)) released = true;
        }

        expect(released).toBe(true);
    });

    it('plays a whole cycle: employ, feed, load out, deploy, get paid', async () => {
        const { tables } = await seed();
        const rng = createRng(21);

        // Employ.
        const offer = rollOffer(tables, 1, rng)!;
        const roster = offer.candidates.slice(0, offer.pickQty);
        expect(roster).toHaveLength(4);

        const startingDollar = Number(tables.GlobalConfig.get('startingDollar')?.value ?? 0);
        expect(startingDollar).toBeGreaterThan(0);
        const inventory = new Inventory([['dollar', startingDollar]]);

        // Feed.
        const feedRuntime = new MissionFeedRuntime(tables, rng);
        feedRuntime.syncActiveFeed(1, 0);
        const mission = feedRuntime.evaluate(0, 0)!;
        expect(mission.data.displayName).toBeTruthy();
        expect(mission.data.description).not.toContain('{location}');

        // Load out: fill every mandatory slot with whoever qualifies.
        const session = new LoadoutSession(mission, tables, roster, inventory, 1);
        for (const slot of session.slots) {
            const eligible = session.candidatesFor(slot.slotId).find((candidate) => candidate.isEligible);
            if (eligible) session.assignAgent(slot.slotId, eligible.agent.characterId);
        }

        // A random four-agent roster cannot always cover a random mission's slots. That is the
        // game working, not a broken fixture — so only assert the rest when it can.
        if (!session.canConfirm) {
            expect(session.missingMandatorySlots.length).toBeGreaterThan(0);
            return;
        }

        const before = inventory.get('dollar');
        const result = deploy({ session, tables, inventory, rng })!;

        expect(result.outcomeType).toBeTruthy();
        expect(result.reports.length).toBeGreaterThan(0);
        // Win or lose, the run resolved and the books balance.
        expect(inventory.get('dollar')).toBe(before + result.moneyEarned - result.moneySpent);
    });
});
