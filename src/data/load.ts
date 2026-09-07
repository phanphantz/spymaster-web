import { ALL_SHEETS, type SheetName } from './sheets';
import { coerceRows } from './coerce';
import { makeTable, mergeLayers, type MergedRows, type RowMap } from './merge';
import {
    DEFAULT_LAYERS,
    browserReader,
    loadLayer,
    layersFromSearch,
    type LayerId,
    type LayerReader,
    type LoadedLayer,
} from './sources';
import { summarise, validate, type ValidationIssue } from './validate';
import type { GameTables } from '../engine/types';

/**
 * The single entry point for game data.
 *
 * Every consumer — the app, a test, a script — goes through here, and every one of them can say
 * exactly which layers it wants. Passing `layers` explicitly is what makes a test hermetic: no
 * fetch, no network, no sheet.
 */

export interface LoadOptions {
    /** Layer stack, in order. Defaults to the URL, then to seed + sheet. */
    layers?: readonly LayerId[];
    /** Where files are read from. Defaults to fetching from public/data. */
    reader?: LayerReader;
    /** Rows supplied directly, applied after every other layer. Handy in tests. */
    overrides?: RowMap;
    /** Base URL for the browser reader. Defaults to the Vite base path. */
    baseUrl?: string;
}

export interface LoadedData {
    tables: GameTables;
    /** Which layers actually contributed, in order, with any that failed marked. */
    layers: readonly LoadedLayer[];
    issues: readonly ValidationIssue[];
    /** Row count per tab, for the dev panel. */
    counts: Record<SheetName, number>;
}

function defaultBaseUrl(): string {
    // import.meta.env is present under Vite and absent in plain Node, so fall back for scripts.
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL;
    return base ?? '/';
}

function defaultLayers(): readonly LayerId[] {
    if (typeof window === 'undefined') return DEFAULT_LAYERS;
    return layersFromSearch(window.location.search);
}

export async function loadTables(options: LoadOptions = {}): Promise<LoadedData> {
    const layerIds = options.layers ?? defaultLayers();
    const reader = options.reader ?? browserReader(options.baseUrl ?? defaultBaseUrl());

    const loaded: LoadedLayer[] = [];
    for (const id of layerIds) {
        loaded.push(await loadLayer(id, reader));
    }

    const stack: RowMap[] = loaded.map((layer) => layer.rows);
    if (options.overrides) stack.push(options.overrides);

    const merged = mergeLayers(stack);
    const coerced = coerceAll(merged);

    return {
        tables: buildTables(coerced),
        layers: loaded,
        issues: validate(coerced),
        counts: countRows(coerced),
    };
}

/**
 * Coercion runs over every layer's output, not just the sheet's.
 *
 * Sheet cells arrive as strings and seed JSON arrives already typed, and running both through the
 * same pass means a hand-edited snapshot behaves identically whether a number was typed as `12` or
 * `"12"` — the difference between the two is exactly the kind of thing that wastes an afternoon.
 */
function coerceAll(merged: MergedRows): MergedRows {
    const result = {} as MergedRows;
    for (const sheet of ALL_SHEETS) {
        result[sheet] = coerceRows(sheet, merged[sheet]) as Record<string, unknown>[];
    }
    return result;
}

function buildTables(rows: MergedRows): GameTables {
    const tables = {} as Record<SheetName, unknown>;
    for (const sheet of ALL_SHEETS) {
        tables[sheet] = makeTable(sheet, rows[sheet]);
    }
    return tables as unknown as GameTables;
}

function countRows(rows: MergedRows): Record<SheetName, number> {
    const counts = {} as Record<SheetName, number>;
    for (const sheet of ALL_SHEETS) counts[sheet] = rows[sheet].length;
    return counts;
}

/** One-line description of a load, for logging and the dev panel. */
export function describeLoad(data: LoadedData): string {
    const { errors, warnings } = summarise(data.issues);
    const layers = data.layers
        .map((layer) => (layer.error ? `${layer.id} (failed)` : layer.id))
        .join(' + ');
    const rows = Object.values(data.counts).reduce((total, count) => total + count, 0);
    return `${layers} — ${rows} rows, ${errors} errors, ${warnings} warnings`;
}

export type { LayerId, LayerReader, LoadedLayer } from './sources';
export type { ValidationIssue } from './validate';
export type { RowMap } from './merge';
