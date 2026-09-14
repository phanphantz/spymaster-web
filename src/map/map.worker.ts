/**
 * Off-main-thread geometry: fetches the baked tiers, triangulates them, and answers hit-tests.
 *
 * Triangulating the fine tier takes ~225 ms on a desktop and several times that on a phone, which
 * would otherwise land as one long frame just as the player starts panning. Meshes are posted as
 * transferables, so handing them over costs nothing, and the worker keeps only the lattice rings —
 * enough to rebuild a tier or pick a feature, a fraction of the mesh size.
 */

import { coarsen, decodeLayer, inflate, type GeoLayer } from './geoCodec';
import { FeaturePicker } from './hitTest';
import { MID_TIER_FACTOR, type TierName } from './mapIndex';
import type { MapWorkerRequest, MapWorkerResponse } from './mapWorkerProtocol';
import { buildTierMesh } from './meshBuilder';

const layers = new Map<TierName, GeoLayer>();
let picker: FeaturePicker | undefined;

function post(message: MapWorkerResponse, transfer: Transferable[] = []): void {
    postMessage(message, { transfer });
}

function postTier(tier: TierName, layer: GeoLayer): void {
    const mesh = buildTierMesh(layer);
    post({ type: 'tier', tier, mesh }, [mesh.vertices, mesh.fillIndices.buffer, mesh.borderIndices.buffer]);
}

async function fetchLayer(url: string): Promise<GeoLayer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return decodeLayer(await inflate(new Uint8Array(await response.arrayBuffer())));
}

async function load(coarseUrl: string, fineUrl: string): Promise<void> {
    const fine = fetchLayer(fineUrl);

    const coarse = await fetchLayer(coarseUrl);
    layers.set('coarse', coarse);
    if (!picker) picker = new FeaturePicker(coarse);
    postTier('coarse', coarse);

    const fineLayer = await fine;
    const mid = coarsen(fineLayer, MID_TIER_FACTOR);
    layers.set('mid', mid);
    layers.set('fine', fineLayer);
    // Picks always run on the finest rings available, so a click lands on the same country
    // whatever tier happens to be on screen.
    picker = new FeaturePicker(fineLayer);
    postTier('mid', mid);
    postTier('fine', fineLayer);
}

onmessage = (event: MessageEvent<MapWorkerRequest>) => {
    const request = event.data;
    switch (request.type) {
        case 'load':
            load(request.coarseUrl, request.fineUrl).catch((error: unknown) =>
                post({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
            );
            break;
        case 'rebuild':
            for (const [tier, layer] of layers) postTier(tier, layer);
            break;
        case 'pick':
            post({ type: 'picked', id: request.id, feature: picker ? picker.pick(request.lon, request.lat) : -1 });
            break;
    }
};
