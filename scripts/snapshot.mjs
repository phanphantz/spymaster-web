#!/usr/bin/env node
/**
 * Freezes the current data layer stack into a snapshot you can edit by hand.
 *
 *   npm run snapshot -- --name my-experiment
 *   npm run snapshot -- --name balance-pass --layers seed,sheet
 *
 * The result is a complete, fully-populated copy of every tab under
 * public/data/snapshots/<name>/, loadable with `?data=snapshot:<name>`. Nothing in it refers back
 * to Google Sheets, so an experiment cannot be moved under your feet by someone editing the sheet.
 *
 * Modules are loaded through Vite rather than compiled first, so this shares one source of truth
 * with the app instead of reimplementing the merge in JavaScript.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_ROOT = join(ROOT, 'public', 'data');

function parseArgs(argv) {
    const args = { name: undefined, layers: undefined };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--name') args.name = argv[++i];
        else if (argv[i] === '--layers') args.layers = argv[++i];
    }
    return args;
}

const { name, layers } = parseArgs(process.argv.slice(2));

if (!name) {
    console.error('Usage: npm run snapshot -- --name <snapshot-name> [--layers seed,sheet]');
    process.exit(1);
}

if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    console.error(`Refusing to write "${name}" — use letters, digits, dot, dash or underscore.`);
    process.exit(1);
}

const server = await createServer({
    root: ROOT,
    // watch: null — this script writes into the project it just loaded, and a live watcher
    // reacts to those writes after the server has closed, which surfaces as a spurious
    // "server is being restarted or closed" stack trace over a successful run.
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'warn',
});

try {
    const { loadTables, describeLoad } = await server.ssrLoadModule('/src/data/load.ts');
    const { nodeReader } = await server.ssrLoadModule('/src/data/nodeReader.ts');
    const { ALL_SHEETS } = await server.ssrLoadModule('/src/data/sheets.ts');

    const layerIds = (layers ?? 'seed,sheet').split(',').map((part) => part.trim()).filter(Boolean);

    const data = await loadTables({ layers: layerIds, reader: nodeReader(DATA_ROOT) });
    console.log(`Resolved ${describeLoad(data)}`);

    for (const layer of data.layers) {
        if (layer.error) console.warn(`  ! ${layer.error}`);
    }

    const target = join(DATA_ROOT, 'snapshots', name);
    // A snapshot is a whole dataset, so a stale tab left behind from a previous run would silently
    // reappear in the merge. Start clean.
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });

    const carried = [];
    for (const sheet of ALL_SHEETS) {
        const rows = data.tables[sheet].rows;
        if (!rows.length) continue;
        await writeFile(join(target, `${sheet}.json`), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
        carried.push(sheet);
    }

    // Names the tabs this snapshot holds, so loading it costs one request per real tab rather than
    // a probe of all 48 with a 404 for most of them.
    await writeFile(join(target, 'index.json'), `${JSON.stringify(carried, null, 2)}\n`, 'utf8');

    console.log(`Wrote ${carried.length} tabs to public/data/snapshots/${name}/`);
    console.log(`Load it with ?data=snapshot:${name}`);
} finally {
    await server.close();
}
