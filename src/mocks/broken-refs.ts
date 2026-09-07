import { defineMock } from './defineMock';

/**
 * Deliberately broken references, so the validator can be seen working.
 *
 * Load it with `?mock=broken-refs` and the dev panel should list one error per dangling id below.
 * It is also what the validator's own test asserts against, which keeps this file honest: if the
 * checks stop firing, that test fails rather than the mock silently becoming valid.
 */
export default defineMock('broken-refs', {
    description: 'Intentionally dangling ids. Exercises the validator; not playable.',

    Mission: [
        {
            missionId: 'mission_with_bad_refs',
            displayName: 'Nothing Resolves',
            // Gate, Outcome and Location that do not exist.
            gateId: 'gate_that_does_not_exist',
            outcomes: ['outcome_that_does_not_exist'],
            locationId: 'nowhere',
        },
    ],

    Gate: [
        {
            gateId: 'gate_with_bad_refs',
            slotReqIds: ['slot_that_does_not_exist'],
            reqItems: [{ itemId: 'item_that_does_not_exist', qty: 1 }],
            reqSkillIds: ['skill_that_does_not_exist'],
        },
    ],
});
