#!/usr/bin/env node
/**
 * Pulls the Game Data spreadsheet into public/data/sheet/.
 *
 *   GCP_SA_KEY='<service account json>' npm run sync
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json npm run sync
 *   npm run sync -- --dry-run
 *
 * The output is the *same JSON shape the Unity importer produces*, because it runs the same
 * column-folding port the app uses. A file written here is interchangeable with one downloaded by
 * Tools/Game Data in the editor.
 *
 * The sheet is a data layer, not a dependency: the game is playable on public/data/seed alone, and
 * a tab this script cannot read is simply left out rather than written empty.
 */

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'public', 'data', 'sheet');

/** The [SPY] Game Data workbook. Same id the Unity GoogleSheetClient defaults to. */
const SPREADSHEET_ID = process.env.SPREADSHEET_ID ?? '1Tlu05U8PVcWbj2zthlFQddsU1O-nWDFdrkfWAZqO0r4';

const dryRun = process.argv.includes('--dry-run');

/**
 * Service-account credentials, read-only.
 *
 * GCP_SA_KEY holds the JSON itself, which is how a GitHub Actions secret arrives. The key must
 * never be committed — it lives in the repository's encrypted secrets, and the spreadsheet has to
 * be shared with the service account's email for any of this to work.
 */
async function credentials() {
    const inline = process.env.GCP_SA_KEY;
    if (inline) return JSON.parse(inline);

    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (path) return JSON.parse(await readFile(path, 'utf8'));

    throw new Error(
        'No credentials. Set GCP_SA_KEY to the service account JSON, or ' +
            'GOOGLE_APPLICATION_CREDENTIALS to a path holding it.',
    );
}

const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'warn',
});

try {
    const { ALL_SHEETS } = await server.ssrLoadModule('/src/data/sheets.ts');
    const { gridToRows } = await server.ssrLoadModule('/src/data/sheetJson.ts');
    const { schemaFor } = await server.ssrLoadModule('/src/data/schemas.ts');

    const auth = new google.auth.GoogleAuth({
        credentials: await credentials(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

    // One batch call rather than 48 round trips.
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        // A tab name may contain spaces, so quote every range.
        ranges: ALL_SHEETS.map((sheet) => `'${sheet}'`),
        majorDimension: 'ROWS',
    });

    const ranges = response.data.valueRanges ?? [];

    if (!dryRun) {
        // Start clean: a tab that has been emptied in the sheet should disappear here too, rather
        // than leaving yesterday's rows behind to be merged over the seed.
        await rm(TARGET, { recursive: true, force: true });
        await mkdir(TARGET, { recursive: true });
    }

    let written = 0;
    let empty = 0;
    const carried = [];

    for (const [index, sheet] of ALL_SHEETS.entries()) {
        const grid = (ranges[index]?.values ?? []).map((row) =>
            (row ?? []).map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
        );

        const rows = gridToRows(grid, schemaFor(sheet));
        if (!rows.length) {
            empty++;
            continue;
        }

        if (!dryRun) {
            await writeFile(join(TARGET, `${sheet}.json`), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
        }
        console.log(`  ${sheet}: ${rows.length} rows`);
        carried.push(sheet);
        written++;
    }

    // The manifest is what stops the browser probing all 48 tabs and 404ing on the 30 this layer
    // does not carry.
    if (!dryRun) {
        await writeFile(
            join(TARGET, 'index.json'),
            `${JSON.stringify(carried, null, 2)}\n`,
            'utf8',
        );
    }

    const readme =
        '# Synced from Google Sheets\n\n' +
        'Written by `.github/workflows/sync-gamedata.yml`. Do not edit by hand — the next sync\n' +
        'overwrites it.\n\n' +
        'This whole directory is optional. The game is playable on `public/data/seed/` alone, and a\n' +
        'missing or malformed file here is logged and skipped rather than being fatal.\n';
    if (!dryRun) await writeFile(join(TARGET, 'README.md'), readme, 'utf8');

    console.log(
        `\n${dryRun ? 'Would write' : 'Wrote'} ${written} tabs to public/data/sheet/ ` +
            `(${empty} tabs are empty in the sheet and were skipped).`,
    );
} finally {
    await server.close();
}
