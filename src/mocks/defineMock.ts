import type { TableRowMap } from '../engine/types';

/**
 * A named data scenario, layered over the seed data.
 *
 * A mock states only the rows it cares about. Everything it does not mention keeps its seed value,
 * because layers merge per row and per field — so a one-mission mock does not have to redefine
 * agents, items, stats or config to be usable.
 */
export interface Mock {
    name: string;
    /** Shown in the dev data panel, so a scenario explains itself months later. */
    description: string;
    rows: TableRowMap;
}

/**
 * Declares a scenario. Typed against the row interfaces, so a mistyped field or a wrong shape is a
 * compile error rather than a mission that silently never fires.
 */
export function defineMock(
    name: string,
    definition: { description: string } & TableRowMap,
): Mock {
    const { description, ...rows } = definition;
    return { name, description, rows: rows as TableRowMap };
}
