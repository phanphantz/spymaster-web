import type { BBox } from './camera';

/** One country, as written to public/map/countries.json by scripts/bake-map.mjs. Features appear in
 *  the same order as the shapes in every baked tier, so an index into this list is the feature id
 *  everything else passes around. */
export interface MapFeature {
    /** Natural Earth ADM0_A3 — ISO-like, but set for every feature (ISO_A3 is -99 for France). */
    id: string;
    name: string;
    /** Bounds of every part, for culling. */
    bbox: BBox;
    /** Bounds of the largest part only, for zoom-to-fit — so France frames France, not French Guiana. */
    focus: BBox;
    /** Natural Earth's own label point. */
    label: readonly [number, number];
    /** Natural Earth MAPCOLOR7: 1–7, assigned so no two neighbours share a value. */
    tint: number;
}

export interface MapIndex {
    version: number;
    features: MapFeature[];
}

export type TierName = 'coarse' | 'mid' | 'fine';

export const MAP_FILES = {
    index: 'map/countries.json',
    coarse: 'map/countries-coarse.bin.gz',
    fine: 'map/countries-fine.bin.gz',
} as const;

/** The fine tier's lattice is 10× the mid tier's — see map.worker.ts. */
export const MID_TIER_FACTOR = 10;
