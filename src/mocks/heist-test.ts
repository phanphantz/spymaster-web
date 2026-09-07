import { defineMock } from './defineMock';

/**
 * A single, tightly-gated mission, for testing outcome selection without the feed's randomness in
 * the way.
 *
 * The Feed is redefined to draw only from this mission's pool with an unlimited quota, so the World
 * Map keeps offering the same job and a loadout can be tried repeatedly against the same Gate.
 * Agents, items, stats and config are all left alone — they come from seed.
 */
export default defineMock('heist-test', {
    description: 'One stealth-gated heist on repeat. For testing Gate tiers and item requirements.',

    Mission: [
        {
            missionId: 'heist',
            type: 'sabotage',
            priorityType: 'high',
            displayName: 'Vault Job',
            description:
                'A private vault in {location} holds a ledger our client would rather nobody read. ' +
                'Take it, leave the money, and be somewhere else by morning.',
            hint: 'Nobody should hear the door open.',
            locationId: 'zurich',
            difficultyLevel: 2,
            penaltyLevel: 2,
            gateId: 'gate_heist_start',
            outcomes: ['heist_clean', 'heist_caught'],
            isDeclinable: true,
        },
    ],

    Gate: [
        // The start Gate carries no requirements of its own — it exists to name the two slots.
        { gateId: 'gate_heist_start', slotReqIds: ['slot_stealth', 'slot_hacker'] },
        // Party stats are summed across both agents; the picklock is checked against pooled items.
        {
            gateId: 'gate_heist_clean',
            sth: 14,
            int: 10,
            reqItems: [{ itemId: 'toolPicklockSet', qty: 1 }],
        },
    ],

    Outcome: [
        {
            outcomeId: 'heist_clean',
            type: 'best',
            gateId: 'gate_heist_clean',
            incidents: ['inc_heist_paid'],
        },
        // Empty Gate, so this always matches. The guaranteed fallback.
        { outcomeId: 'heist_caught', type: 'criticalFailure', incidents: ['inc_heist_caught'] },
    ],

    Incident: [
        {
            incidentId: 'inc_heist_paid',
            displayName: 'Ledger recovered',
            description: 'The door never made a sound. Payment cleared before dawn.',
            rewardExp: 200,
            rewardItems: [{ itemId: 'dollar', qty: 6000 }],
        },
        {
            incidentId: 'inc_heist_caught',
            displayName: 'Alarm tripped',
            description: 'Somebody heard the door. The team got out; the ledger did not.',
            effects: [{ effectId: 'effInjury', effectValue: '15' }],
        },
    ],

    MissionPool: [
        { poolId: 'pool_heist_test', entries: [{ entryId: 'heist', weight: 1 }] },
    ],

    MissionFeed: [
        {
            feedId: 'feed_prototype',
            // qty 0 is an unlimited quota, so the mission keeps coming back.
            pools: [{ poolId: 'pool_heist_test', qty: 0 }],
            minFeedIntervalMinute: 10,
            maxFeedIntervalMinute: 20,
            maxActiveCount: 2,
        },
    ],
});
