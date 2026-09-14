# Spymaster — web prototype

A browser prototype of [Spymaster](https://github.com/phanphantz/aoc-prototype), a strategy /
management sim where you run a freelance spy agency: missions arrive, you pick agents and kit, and
you live with the result.

It exists to iterate on game feel and balance faster than the Unity build can, and to be playable on
a phone from a URL.

**Play it: https://phanphantz.github.io/spymaster-web/** The engine is deliberately written as plain TypeScript mirroring the Unity C#
classes one-to-one, so rules and tuning port back.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine test suite
npm run build
```

## Scope of v1

Missions are fed onto a contract board over time, you employ a starting roster, accept a mission,
assign agents and buy items in the Loadout, and deployment resolves immediately to a pass or fail.

The game plays over a pannable, zoomable vector world map (countries only, no labels yet), with a
pin on every pending contract and the board floating over its top-right corner.

Out of scope for now: Tasks, Events, progression, saves, states/cities and map labels, agent rest.

## The world map

`src/map/` draws the same Natural Earth country outlines as the Unity map, with WebGL2 and no map
library. A frame only runs while the camera moves, so an idle map costs nothing.

- **Baked, not parsed at runtime.** `npm run bake-map` reads the Unity project's
  `countries.geojson` (from the sibling `aoc-prototype` checkout by default; `--src` for another
  path) and writes `public/map/`: a 20 KB coarse tier and a 431 KB fine tier. Commit the output;
  the 23 MB source stays out of this repo.
- **Grid snapping, not RDP**, same as Unity's `GeoMeshBaker`, so borders shared by two countries
  stay welded at every tier. A mid tier is derived from the fine one at load.
- **A Web Worker** triangulates the tiers and answers click hit-tests, so the main thread never
  stalls. Tiers go to the GPU once; pan and zoom only change uniforms, and the renderer swaps tier
  by zoom and skips countries off screen.
- The map lives outside React: the game store re-renders on every clock tick, and none of that
  reaches the canvas. UI that covers the map carries `data-map-occluder`, so zoom-to-fit lands its
  target in the uncovered part of the screen.

## Where the data comes from

The game loads through one layered pipeline. **The Google Sheet is an optional layer, never a
dependency** — the prototype is fully playable on committed seed data alone.

| Layer | Source | Purpose |
|---|---|---|
| `seed` | `public/data/seed/` | the baseline; always present |
| `sheet` | `public/data/sheet/` | synced from the Game Data sheet by a workflow |
| `mock:<name>` | `src/mocks/<name>.ts` | a typed, hand-written scenario |
| `snapshot:<name>` | `public/data/snapshots/<name>/` | a frozen, hand-editable full copy |

Layers merge in order, per row, keyed by that table's id — a later layer overrides **only the fields
it actually sets**, so a partial row is a patch rather than a replacement.

Pick a layer stack with a query string:

```
?data=seed                    only seed, no sheet
?nosheet=1                    the default stack minus the sheet
?mock=heist-test              seed + that mock
?data=seed,mock:heist-test    explicit
?data=snapshot:my-experiment  a frozen copy
```

`npm run snapshot -- --name my-experiment` freezes the current stack into a snapshot you can edit by
hand — the "copy the sheet and make up a mission" workflow, with no Google round-trip.

### Syncing the sheet

`.github/workflows/sync-gamedata.yml` pulls all 48 tabs into `public/data/sheet/` and commits any
change, which triggers the Pages deploy — roughly 60-90 seconds from a sheet edit to the live page.
Run it by hand from the Actions tab, or let the daily schedule pick it up.

The spreadsheet stays private. The job reads it with a Google service account whose key lives in the
repository secret `GCP_SA_KEY`, never in the repository itself, and the sheet has to be shared with
that service account's email address for the job to see anything.

Locally:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm run sync -- --dry-run
```

The output is the same JSON shape the Unity importer produces, so a file synced here is
interchangeable with one downloaded through Tools/Game Data in the editor.

`src/data/sheet-guard.test.ts` is what makes this safe to run unattended: it merges the pull over the
seed and fails if a reference dangles, if a shop item is priced in something that does not exist, or
if the Feed has been left with nothing to draw. The workflow only commits when the tests pass, so a
bad pull leaves the site serving the last good data.

## Licence

Unpublished game design. Code here is a prototype and carries no warranty.
