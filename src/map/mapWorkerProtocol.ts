import type { TierName } from './mapIndex';
import type { TierMesh } from './meshBuilder';

export type MapWorkerRequest =
    /** Fetch both baked files and post each tier's mesh as it is ready, coarsest first. */
    | { type: 'load'; coarseUrl: string; fineUrl: string }
    /** Re-post every tier already built — after a lost WebGL context took the GPU copies with it. */
    | { type: 'rebuild' }
    | { type: 'pick'; id: number; lon: number; lat: number };

export type MapWorkerResponse =
    | { type: 'tier'; tier: TierName; mesh: TierMesh }
    | { type: 'picked'; id: number; feature: number }
    | { type: 'error'; message: string };
