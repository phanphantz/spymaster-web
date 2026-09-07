import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseManifest, type LayerReader } from './sources';

/**
 * Reads data layers straight off disk.
 *
 * Kept out of `sources.ts` so nothing in the browser bundle ever imports `node:fs`. Used by the
 * snapshot and sync scripts, and by tests that want the real seed data rather than a fixture.
 */
export function nodeReader(dataRoot: string): LayerReader {
    const readJson = async (path: string): Promise<unknown> => {
        try {
            return JSON.parse(await readFile(join(dataRoot, path), 'utf8'));
        } catch {
            // A file a layer does not carry is normal, not an error.
            return undefined;
        }
    };

    return {
        async readTab(directory, sheet) {
            const parsed = await readJson(join(directory, `${sheet}.json`));
            return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : undefined;
        },
        async readManifest(directory) {
            return parseManifest(await readJson(join(directory, 'index.json')));
        },
    };
}
