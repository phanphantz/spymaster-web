#!/usr/bin/env node
/**
 * Bakes the world map's country geometry from Natural Earth GeoJSON.
 *
 *   npm run bake-map
 *   npm run bake-map -- --src path/to/countries.geojson
 *
 * The source is the same Admin-0 10m file the Unity map imports
 * (aoc-prototype/Assets/RawData/WorldMap/countries.geojson), read from the sibling checkout by
 * default. It is 23 MB, so it stays out of this repository — only the baked output below is
 * committed, and the web map matches the Unity one because both start from the same file.
 *
 * Writes to public/map/:
 *   countries.json            per-feature index: id, name, bounds, focus bounds, label point, tint
 *   countries-coarse.bin.gz   0.4° lattice — tiny, so the map can draw before the fine tier lands
 *   countries-fine.bin.gz     0.01° lattice — the app derives its mid tier from this one
 *
 * Geometry is encoded by src/map/geoCodec.ts, loaded through Vite so the app and this script share
 * one implementation of the format.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'map');
const DEFAULT_SRC = resolve(ROOT, '..', 'aoc-prototype', 'Assets', 'RawData', 'WorldMap', 'countries.geojson');

const FINE_DEG = 0.01;
const COARSE_DEG = 0.4;

/** Features left out of the bake. Antarctica sits below the map's pannable bounds (see camera.ts),
 *  and at 10m it is a large share of all the points for something never on screen. */
const EXCLUDE = new Set(['ATA']);

function parseArgs(argv) {
    const args = { src: DEFAULT_SRC };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--src') args.src = resolve(argv[++i]);
    }
    return args;
}

/** GeoJSON Polygon / MultiPolygon → parts → rings → flat [lon, lat, …]. */
function partsOf(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
    return polygons.map((polygon) => polygon.map((ring) => ring.flat()));
}

function boundsOf(flatRings) {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const ring of flatRings) {
        for (let i = 0; i < ring.length; i += 2) {
            west = Math.min(west, ring[i]);
            east = Math.max(east, ring[i]);
            south = Math.min(south, ring[i + 1]);
            north = Math.max(north, ring[i + 1]);
        }
    }
    return [west, south, east, north];
}

function ringArea(ring) {
    let twice = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        twice += (ring[j] - ring[i]) * (ring[j + 1] + ring[i + 1]);
    }
    return Math.abs(twice) / 2;
}

const round3 = (value) => Math.round(value * 1000) / 1000;

const { src } = parseArgs(process.argv.slice(2));

let geojson;
try {
    geojson = JSON.parse(await readFile(src, 'utf8'));
} catch (error) {
    console.error(`Could not read ${src}: ${error.message}`);
    console.error('Pass the Natural Earth Admin-0 countries GeoJSON with --src.');
    process.exit(1);
}

const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'warn',
});

try {
    const { snapPart, encodeLayer } = await server.ssrLoadModule('/src/map/geoCodec.ts');

    const features = [];
    const fineShapes = [];
    const coarseShapes = [];

    for (const feature of geojson.features) {
        const props = feature.properties ?? {};
        const id = props.ADM0_A3;
        if (!id || EXCLUDE.has(id) || !feature.geometry) continue;

        const parts = partsOf(feature.geometry);
        if (parts.length === 0) continue;

        // Focus on the largest landmass rather than the whole feature — France's bounds would
        // otherwise span French Guiana and Réunion, and Russia's the full antimeridian.
        let mainPart = parts[0];
        for (const part of parts) if (ringArea(part[0]) > ringArea(mainPart[0])) mainPart = part;

        features.push({
            id,
            name: props.NAME ?? props.ADMIN ?? id,
            bbox: boundsOf(parts.map((part) => part[0])).map(round3),
            focus: boundsOf([mainPart[0]]).map(round3),
            label: [round3(props.LABEL_X ?? 0), round3(props.LABEL_Y ?? 0)],
            tint: props.MAPCOLOR7 ?? 1,
        });

        fineShapes.push(parts.map((part) => snapPart(part, FINE_DEG)).filter(Boolean));
        coarseShapes.push(parts.map((part) => snapPart(part, COARSE_DEG)).filter(Boolean));
    }

    await mkdir(OUT, { recursive: true });

    const fine = encodeLayer({ unitDeg: FINE_DEG, shapes: fineShapes });
    const coarse = encodeLayer({ unitDeg: COARSE_DEG, shapes: coarseShapes });
    const fineGz = gzipSync(fine, { level: 9 });
    const coarseGz = gzipSync(coarse, { level: 9 });

    await writeFile(join(OUT, 'countries-fine.bin.gz'), fineGz);
    await writeFile(join(OUT, 'countries-coarse.bin.gz'), coarseGz);
    await writeFile(join(OUT, 'countries.json'), `${JSON.stringify({ version: 1, features })}\n`, 'utf8');

    const pointsIn = (shapes) => shapes.reduce((sum, shape) => sum + shape.reduce((s, part) => s + part.reduce((r, ring) => r + ring.length / 2, 0), 0), 0);
    console.log(`Baked ${features.length} countries from ${src}`);
    console.log(`  fine    ${FINE_DEG}°  ${pointsIn(fineShapes).toLocaleString()} points  ${(fineGz.length / 1024).toFixed(0)} KB`);
    console.log(`  coarse  ${COARSE_DEG}°  ${pointsIn(coarseShapes).toLocaleString()} points  ${(coarseGz.length / 1024).toFixed(0)} KB`);
} finally {
    await server.close();
}
