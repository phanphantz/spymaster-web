import { describe, expect, it } from 'vitest';
import { addExp, createAgent, expForNextLevel, previewExpGain } from './runtimeAgent';

function agent() {
    return createAgent({ characterId: 'x' });
}

describe('exp/level curve', () => {
    it('starts at level 1 with 0 exp, 500 to the next level', () => {
        const a = agent();
        expect(a.level).toBe(1);
        expect(a.exp).toBe(0);
        expect(expForNextLevel(a)).toBe(500);
    });

    it('addExp accumulates without levelling up below the threshold', () => {
        const a = agent();
        const gained = addExp(a, 300);
        expect(gained).toBe(0);
        expect(a.level).toBe(1);
        expect(a.exp).toBe(300);
    });

    it('addExp levels up and carries the remainder, not resetting it', () => {
        const a = agent();
        const gained = addExp(a, 600);
        expect(gained).toBe(1);
        expect(a.level).toBe(2);
        expect(a.exp).toBe(100);
        expect(expForNextLevel(a)).toBe(1000);
    });

    it('addExp resolves more than one level-up from a single large reward', () => {
        const a = agent();
        // 500 to clear level 1, 1000 to clear level 2, 200 left over into level 3.
        const gained = addExp(a, 500 + 1000 + 200);
        expect(gained).toBe(2);
        expect(a.level).toBe(3);
        expect(a.exp).toBe(200);
    });

    it('previewExpGain does not mutate the agent', () => {
        const a = agent();
        addExp(a, 300);
        const preview = previewExpGain(a, 150);
        expect(a.exp).toBe(300);
        expect(a.level).toBe(1);
        expect(preview).toEqual({ max: 500, filledTo: 450, levelsGained: 0 });
    });

    it('previewExpGain past the threshold reports the level-up and fills to max', () => {
        const a = agent();
        addExp(a, 300);
        const preview = previewExpGain(a, 400);
        expect(preview.levelsGained).toBe(1);
        expect(preview.filledTo).toBe(preview.max);
    });
});
