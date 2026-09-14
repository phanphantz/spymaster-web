import type { GeoLayer } from './geoCodec';

/**
 * Point-in-polygon picking against the stored rings — no colliders, same as Unity's
 * `GeoFeatureData.ContainsPoint`. Always run against the finest tier available, so what a click hits
 * doesn't change as the displayed tier swaps with zoom.
 */
export class FeaturePicker {
    /** Per shape `[minX, minY, maxX, maxY]` in lattice units, for a cheap reject before the ring walk. */
    private readonly bounds: Float64Array;

    constructor(private readonly layer: GeoLayer) {
        this.bounds = new Float64Array(layer.shapes.length * 4);
        layer.shapes.forEach((shape, s) => {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const part of shape) {
                const outer = part[0];
                for (let i = 0; i < outer.length; i += 2) {
                    minX = Math.min(minX, outer[i]);
                    maxX = Math.max(maxX, outer[i]);
                    minY = Math.min(minY, outer[i + 1]);
                    maxY = Math.max(maxY, outer[i + 1]);
                }
            }
            this.bounds.set([minX, minY, maxX, maxY], s * 4);
        });
    }

    /** The index of the feature containing (lon, lat), or -1 for open sea. */
    pick(lon: number, lat: number): number {
        const x = lon / this.layer.unitDeg;
        const y = lat / this.layer.unitDeg;
        const b = this.bounds;

        for (let s = 0; s < this.layer.shapes.length; s++) {
            if (x < b[s * 4] || y < b[s * 4 + 1] || x > b[s * 4 + 2] || y > b[s * 4 + 3]) continue;
            for (const part of this.layer.shapes[s]) {
                // Even-odd across the outer ring and its holes: inside a hole flips back to outside.
                let inside = false;
                for (const ring of part) if (ringCrossings(ring, x, y)) inside = !inside;
                if (inside) return s;
            }
        }
        return -1;
    }
}

/** Whether a ray from (x, y) crosses the ring an odd number of times. */
function ringCrossings(ring: Int32Array, x: number, y: number): boolean {
    let odd = false;
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = ring[i * 2];
        const yi = ring[i * 2 + 1];
        const xj = ring[j * 2];
        const yj = ring[j * 2 + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
}
