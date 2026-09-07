import type { SheetSchema, SheetColumnGroup } from './schemas';

/**
 * Converts a sheet's string grid into JSON rows, using the first row as field names.
 *
 * Port of `Assets/Scripts/GoogleSheet/SheetJson.cs` and `SheetLayout.cs`. The output shape must
 * stay identical to Unity's, because a synced JSON file is meant to be interchangeable between the
 * two projects.
 *
 * Repetition in the header is the signal: `tags | tags | tags` is one array of plain values, and a
 * declared column group repeating across the row is an array of objects. Folding happens here so
 * nothing downstream has to zip parallel columns back up.
 */

/** A cell value as it comes out of the grid: always a string, never a number or boolean. */
export type RawRow = Record<string, string | string[] | Record<string, string>[]>;

/**
 * Strips the optional type tag from a column name, so "Level (int)" becomes "Level" and "Tags[]"
 * becomes "Tags".
 */
export function extractFieldName(columnName: string): string {
    if (!columnName || !columnName.trim()) return columnName ?? '';

    const withoutArrayTag = columnName.replace('[]', '');
    const open = withoutArrayTag.lastIndexOf('(');
    const close = withoutArrayTag.lastIndexOf(')');
    if (open === -1 || close === -1 || open >= close) return withoutArrayTag.trim();

    return withoutArrayTag.slice(0, open).trim();
}

/**
 * Turns a sideways grid upright: field names running down column A become the header row, and each
 * record's column becomes a row. Ragged columns are padded.
 */
export function transpose(data: readonly (readonly string[])[]): string[][] {
    if (!data.length) return [];

    const width = Math.max(...data.map((row) => row?.length ?? 0));
    const result: string[][] = [];

    for (let column = 0; column < width; column++) {
        result.push(data.map((sourceRow) => sourceRow?.[column] ?? ''));
    }

    return result;
}

/** One JSON member and the grid columns that feed it. */
interface Member {
    name: string;
    /** JSON keys of one entry, or null when the member is a bare value per column. */
    keys: readonly string[] | null;
    /** Column indices, one array per repeat of the member. */
    instances: number[][];
}

class SheetLayout {
    private constructor(private readonly members: readonly Member[]) {}

    /**
     * Reads a header row and works out what each JSON member is: a plain value, an array of values,
     * or an array of objects.
     */
    static build(fieldNames: readonly string[], schema?: SheetSchema): SheetLayout {
        const members: Member[] = [];
        const byName = new Map<string, Member>();
        const consumed = new Array<boolean>(fieldNames.length).fill(false);

        const getOrAdd = (name: string, keys: readonly string[] | null): Member => {
            const existing = byName.get(name);
            if (existing) return existing;

            const member: Member = { name, keys, instances: [] };
            members.push(member);
            byName.set(name, member);
            return member;
        };

        // Declared groups first: they span several columns, so they must claim those columns before
        // any of the names is read as a repeating single-value member.
        if (schema) {
            for (let i = 0; i < fieldNames.length; i++) {
                if (consumed[i]) continue;

                const matched = schema.groups.find((candidate) => matchesAt(candidate, fieldNames, i));
                if (!matched) continue;

                const member = getOrAdd(matched.memberName, matched.keys);

                // Consecutive repeats of the same group are further entries of the same array.
                while (matchesAt(matched, fieldNames, i)) {
                    const instance: number[] = [];
                    for (let offset = 0; offset < matched.columns.length; offset++) {
                        instance.push(i + offset);
                        consumed[i + offset] = true;
                    }
                    member.instances.push(instance);
                    i += matched.columns.length;
                }

                i--;
            }
        }

        for (let i = 0; i < fieldNames.length; i++) {
            if (consumed[i] || !fieldNames[i]) continue;

            getOrAdd(fieldNames[i], null).instances.push([i]);
            consumed[i] = true;
        }

        // Groups are claimed in a first pass, so put the members back in column order — the JSON
        // then reads down the sheet the way the author laid it out, id column first.
        members.sort((left, right) => firstColumn(left) - firstColumn(right));

        return new SheetLayout(members);
    }

    /** Builds one JSON row from a data row. Blank cells are left out entirely. */
    buildRow(cells: readonly string[]): RawRow {
        const row: RawRow = {};

        for (const member of this.members) {
            if (isSingleValue(member)) {
                const value = cell(cells, member.instances[0][0]);
                if (value) row[member.name] = value;
                continue;
            }

            if (member.keys === null) {
                const values: string[] = [];
                for (const [index] of member.instances) {
                    const value = cell(cells, index);
                    if (value) values.push(value);
                }
                if (values.length) row[member.name] = values;
                continue;
            }

            const entries: Record<string, string>[] = [];
            for (const instance of member.instances) {
                const entry: Record<string, string> = {};
                member.keys.forEach((key, i) => {
                    const value = cell(cells, instance[i]);
                    if (value) entry[key] = value;
                });
                if (Object.keys(entry).length) entries.push(entry);
            }
            if (entries.length) row[member.name] = entries;
        }

        return row;
    }
}

function matchesAt(
    candidate: SheetColumnGroup,
    fieldNames: readonly string[],
    index: number,
): boolean {
    if (index + candidate.columns.length > fieldNames.length) return false;
    return candidate.columns.every((column, offset) => fieldNames[index + offset] === column);
}

/** A single column, appearing once, holding one value rather than an array. */
function isSingleValue(member: Member): boolean {
    return member.keys === null && member.instances.length === 1;
}

function firstColumn(member: Member): number {
    return member.instances.length ? member.instances[0][0] : Number.MAX_SAFE_INTEGER;
}

function cell(cells: readonly string[], index: number): string {
    return (cells[index] ?? '').trim();
}

/**
 * Turns a grid into JSON rows. The first row supplies the field names.
 *
 * Blank cells are left out rather than written as empty strings: most of the sheet is blank, and a
 * row carrying only what was authored is what lets a later data layer patch rather than replace.
 */
export function gridToRows(
    data: readonly (readonly string[])[],
    schema?: SheetSchema,
): RawRow[] {
    if (!data.length) return [];

    const grid = schema?.isTransposed ? transpose(data) : data;
    if (!grid.length) return [];

    const fieldNames = grid[0].map(extractFieldName);
    const layout = SheetLayout.build(fieldNames, schema);

    const rows: RawRow[] = [];
    for (let i = 1; i < grid.length; i++) {
        const row = layout.buildRow(grid[i]);
        if (Object.keys(row).length) rows.push(row);
    }

    return rows;
}
