import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LayerReader } from './sources';

/**
 * Reads data layers straight off disk.
 *
 * Kept out of `sources.ts` so nothing in the browser bundle ever imports `node:fs`. Used by the
 * snapshot and sync scripts, and by tests that want the real seed data rather than a fixture.
 */
export function nodeReader(dataRoot: string): LayerReader {
    return {
        async readTab(directory, sheet) {
            try {
                const text = await readFile(join(dataRoot, directory, `${sheet}.json`), 'utf8');
                const parsed: unknown = JSON.parse(text);
                return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : undefined;
            } catch {
                // A tab a layer does not carry is normal, not an error.
                return undefined;
            }
        },
    };
}
