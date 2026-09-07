# Spymaster — web prototype

A browser prototype of [Spymaster](https://github.com/phanphantz/aoc-prototype), a strategy /
management sim where you run a freelance spy agency: missions arrive, you pick agents and kit, and
you live with the result.

It exists to iterate on game feel and balance faster than the Unity build can, and to be playable on
a phone from a URL. The engine is deliberately written as plain TypeScript mirroring the Unity C#
classes one-to-one, so rules and tuning port back.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine test suite
npm run build
```

## Scope of v1

Missions are fed onto a list over time, you employ a starting roster, accept a mission, assign agents
and buy items in the Loadout, and deployment resolves immediately to a pass or fail.

Out of scope for now: Tasks, Events, progression, saves, world map, agent rest.

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

**The sync is currently blocked on one column.** The workbook prices every Item in `usd`, while the
code constant is `dollar` (`ItemIds.Dollar`), so a pull leaves 303 dangling price references and a
shop where nothing is affordable. `src/data/sheet-guard.test.ts` fails on that, and the workflow only
commits when the tests pass — so the site keeps serving the last good data instead. Settle
`Item.priceItemId` on `dollar` in the sheet and the sync goes green.

## Licence

Unpublished game design. Code here is a prototype and carries no warranty.
