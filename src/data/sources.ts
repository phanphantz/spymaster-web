import { ALL_SHEETS, type SheetName } from './sheets';
import type { RowMap } from './merge';
import { getMock } from '../mocks';

/**
 * Where game data comes from, and how a layer stack is chosen.
 *
 * The Google Sheet is one optional layer, never a dependency: the prototype is fully playable on
 * committed seed data alone, and a mock or a snapshot can stand in for the sheet entirely.
 */

export type LayerId =
    /** The committed baseline. Always present, always first. */
    | 'seed'
    /** Synced from the Game Data sheet by the sync workflow. Absent is normal, not an error. */
    | 'sheet'
    /** `mock:<name>` — a typed scenario written by hand in src/mocks. */
    | `mock:${string}`
    /** `snapshot:<name>` — a frozen full copy under public/data/snapshots. */
    | `snapshot:${string}`;

export const DEFAULT_LAYERS: readonly LayerId[] = ['seed', 'sheet'];

export interface LoadedLayer {
    id: LayerId;
    rows: RowMap;
    /** Set when a layer was requested but could not be read. The load continues without it. */
    error?: string;
}

/**
 * Reads a layer stack out of the URL, so a scenario can be linked, bookmarked, or opened on a
 * phone. Precedence, highest first:
 *
 *   ?data=seed,mock:heist-test   an explicit stack
 *   ?mock=heist-test             shorthand for seed + that mock
 *   ?snapshot=my-experiment      shorthand for that snapshot alone
 *   ?nosheet=1                   the default stack minus the sheet
 */
export function layersFromSearch(search: string): LayerId[] {
    const params = new URLSearchParams(search);

    const explicit = params.get('data');
    if (explicit) {
        const parsed = explicit
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean) as LayerId[];
        if (parsed.length) return parsed;
    }

    const mock = params.get('mock');
    if (mock) return ['seed', `mock:${mock}`];

    const snapshot = params.get('snapshot');
    if (snapshot) return [`snapshot:${snapshot}`];

    if (params.get('nosheet') !== null) {
        return DEFAULT_LAYERS.filter((layer) => layer !== 'sheet');
    }

    return [...DEFAULT_LAYERS];
}

/** How a layer reads its files. Swapped out in tests and in the Node scripts. */
export interface LayerReader {
    /** Resolves a tab to its rows, or undefined when that tab is not present in the layer. */
    readTab(directory: string, sheet: SheetName): Promise<Record<string, unknown>[] | undefined>;
    /** The tabs this layer holds, or undefined when it carries no manifest. */
    readManifest(directory: string): Promise<SheetName[] | undefined>;
}

/** Only tabs the workbook actually has can be in a manifest; anything else is ignored. */
export function parseManifest(parsed: unknown): SheetName[] | undefined {
    if (!Array.isArray(parsed)) return undefined;
    const known = new Set<string>(ALL_SHEETS);
    return parsed.filter((entry): entry is SheetName => typeof entry === 'string' && known.has(entry));
}

/** Fetches JSON from public/data, the way the browser sees it. */
export function browserReader(baseUrl: string): LayerReader {
    const readJson = async (path: string): Promise<unknown> => {
        const response = await fetch(`${baseUrl}data/${path}`);
        if (!response.ok) return undefined;
        return response.json();
    };

    return {
        async readTab(directory, sheet) {
            const parsed = await readJson(`${directory}/${sheet}.json`);
            return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : undefined;
        },
        async readManifest(directory) {
            return parseManifest(await readJson(`${directory}/index.json`));
        },
    };
}

async function readDirectoryLayer(
    reader: LayerReader,
    directory: string,
): Promise<RowMap> {
    // Each layer directory carries an index.json naming the tabs it actually holds. Without one,
    // loading a layer means probing all 48 tabs and 404ing on most of them — dozens of wasted
    // requests, and a console full of failures that hide the real ones. Written by the sync and
    // snapshot scripts.
    const manifest = await reader.readManifest(directory).catch(() => undefined);
    const tabs = manifest ?? ALL_SHEETS;

    const rows: RowMap = {};
    await Promise.all(
        tabs.map(async (sheet) => {
            const tab = await reader.readTab(directory, sheet).catch(() => undefined);
            if (tab?.length) rows[sheet] = tab;
        }),
    );
    return rows;
}

/**
 * Resolves one layer id to its rows.
 *
 * A layer that cannot be read is reported and skipped, never thrown: a missing or malformed sheet
 * sync must degrade to the seed data rather than blanking the page.
 */
export async function loadLayer(id: LayerId, reader: LayerReader): Promise<LoadedLayer> {
    try {
        if (id === 'seed') return { id, rows: await readDirectoryLayer(reader, 'seed') };
        if (id === 'sheet') return { id, rows: await readDirectoryLayer(reader, 'sheet') };

        if (id.startsWith('mock:')) {
            const name = id.slice('mock:'.length);
            const mock = getMock(name);
            if (!mock) return { id, rows: {}, error: `No mock named "${name}"` };
            return { id, rows: mock.rows as RowMap };
        }

        if (id.startsWith('snapshot:')) {
            const name = id.slice('snapshot:'.length);
            const rows = await readDirectoryLayer(reader, `snapshots/${name}`);
            if (!Object.keys(rows).length) {
                return { id, rows: {}, error: `No snapshot named "${name}"` };
            }
            return { id, rows };
        }

        return { id, rows: {}, error: `Unknown data layer "${id}"` };
    } catch (cause) {
        return { id, rows: {}, error: `Could not read layer "${id}": ${String(cause)}` };
    }
}
