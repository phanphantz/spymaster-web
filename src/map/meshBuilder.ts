import earcut from 'earcut';
import type { GeoLayer } from './geoCodec';

/**
 * Turns one tier of lattice geometry into GPU-ready buffers — the web counterpart of Unity's
 * GeoMeshBaker.
 *
 * Every ring point becomes two vertices sharing its position: the even one carries the point's
 * miter offset, the odd one the same offset negated. Fills triangulate over the even vertices only
 * (and ignore the offset); borders are a ribbon strung between each even/odd pair. Offsets are unit
 * miters, not a width — the vertex shader multiplies them by a half-width in lattice units derived
 * from the current zoom, so borders hold a constant on-screen width without ever re-baking. This is
 * the same trick as Unity's `_ZoomWidthScale`.
 *
 * One shared ribbon per ring means an internal border is drawn twice, once by each neighbour. The
 * geometry is identical (the lattice welds it), so with an opaque border colour that is invisible.
 */

/** Bytes per vertex: int16 x, int16 y, int8 offset x, int8 offset y, uint16 feature index. */
export const VERTEX_STRIDE = 8;

/** Sharp corners are clamped to this many half-widths rather than spiking off to infinity. The
 *  stored int8 offset is `miter / MITER_LIMIT`, so the shader scales it back up by the same amount. */
export const MITER_LIMIT = 2;

export interface TierMesh {
    unitDeg: number;
    vertices: ArrayBuffer;
    fillIndices: Uint32Array;
    borderIndices: Uint32Array;
    /** Per feature, `[firstIndex, indexCount]` into `fillIndices` — features are laid out in index
     *  order, so a run of consecutive visible features is one contiguous draw. */
    fillRanges: Uint32Array;
    borderRanges: Uint32Array;
}

export function buildTierMesh(layer: GeoLayer): TierMesh {
    let pointCount = 0;
    let fillBound = 0;
    for (const shape of layer.shapes) {
        for (const part of shape) {
            let partPoints = 0;
            for (const ring of part) partPoints += ring.length / 2;
            pointCount += partPoints;
            // Earcut emits n + 2h − 2 triangles for a polygon with n points and h holes.
            fillBound += (partPoints + 2 * (part.length - 1)) * 3;
        }
    }

    const vertices = new ArrayBuffer(pointCount * 2 * VERTEX_STRIDE);
    const view = new DataView(vertices);
    const fillIndices = new Uint32Array(fillBound);
    const borderIndices = new Uint32Array(pointCount * 6);
    const fillRanges = new Uint32Array(layer.shapes.length * 2);
    const borderRanges = new Uint32Array(layer.shapes.length * 2);

    let point = 0;
    let fillCount = 0;
    let borderCount = 0;

    for (let feature = 0; feature < layer.shapes.length; feature++) {
        fillRanges[feature * 2] = fillCount;
        borderRanges[feature * 2] = borderCount;

        for (const part of layer.shapes[feature]) {
            const partStart = point;
            const flat: number[] = [];
            const holes: number[] = [];

            for (let r = 0; r < part.length; r++) {
                const ring = part[r];
                const n = ring.length / 2;
                if (r > 0) holes.push(flat.length / 2);
                for (let i = 0; i < ring.length; i++) flat.push(ring[i]);

                for (let i = 0; i < n; i++) {
                    // Quantize once and negate the integer — rounding each side separately would
                    // make the ribbon a step lopsided wherever the offset lands on a half.
                    const [mx, my] = miter(ring, i, n);
                    const ox = Math.round((mx / MITER_LIMIT) * 127);
                    const oy = Math.round((my / MITER_LIMIT) * 127);
                    writeVertex(view, (point + i) * 2, ring[i * 2], ring[i * 2 + 1], ox, oy, feature);
                    writeVertex(view, (point + i) * 2 + 1, ring[i * 2], ring[i * 2 + 1], -ox, -oy, feature);

                    const a = (point + i) * 2;
                    const b = (point + ((i + 1) % n)) * 2;
                    borderIndices[borderCount++] = a;
                    borderIndices[borderCount++] = a + 1;
                    borderIndices[borderCount++] = b;
                    borderIndices[borderCount++] = a + 1;
                    borderIndices[borderCount++] = b + 1;
                    borderIndices[borderCount++] = b;
                }
                point += n;
            }

            const triangles = earcut(flat, holes);
            for (let i = 0; i < triangles.length; i++) fillIndices[fillCount++] = (partStart + triangles[i]) * 2;
        }

        fillRanges[feature * 2 + 1] = fillCount - fillRanges[feature * 2];
        borderRanges[feature * 2 + 1] = borderCount - borderRanges[feature * 2];
    }

    return {
        unitDeg: layer.unitDeg,
        vertices,
        fillIndices: fillIndices.slice(0, fillCount),
        borderIndices,
        fillRanges,
        borderRanges,
    };
}

/** The miter at point i of a closed ring: the direction and length that offset a ribbon of
 *  half-width 1 so its edges stay parallel to both neighbouring segments. */
export function miter(ring: ArrayLike<number>, i: number, n: number): [number, number] {
    const prev = ((i - 1 + n) % n) * 2;
    const next = ((i + 1) % n) * 2;
    const x = ring[i * 2];
    const y = ring[i * 2 + 1];

    const [ax, ay] = unit(x - ring[prev], y - ring[prev + 1]);
    const [bx, by] = unit(ring[next] - x, ring[next + 1] - y);

    // Left-hand normals of the incoming and outgoing segments.
    const n0x = -ay;
    const n0y = ax;
    const n1x = -by;
    const n1y = bx;

    let mx = n0x + n1x;
    let my = n0y + n1y;
    const length = Math.hypot(mx, my);

    // A spike doubling straight back on itself has no miter — square it off instead.
    if (length < 1e-6) return [n0x, n0y];

    mx /= length;
    my /= length;
    const scale = Math.min(MITER_LIMIT, 1 / Math.max(mx * n0x + my * n0y, 1e-6));
    return [mx * scale, my * scale];
}

function unit(x: number, y: number): [number, number] {
    const length = Math.hypot(x, y);
    return length === 0 ? [0, 0] : [x / length, y / length];
}

function writeVertex(view: DataView, index: number, x: number, y: number, ox: number, oy: number, feature: number): void {
    const at = index * VERTEX_STRIDE;
    view.setInt16(at, x, true);
    view.setInt16(at + 2, y, true);
    view.setInt8(at + 4, ox);
    view.setInt8(at + 5, oy);
    view.setUint16(at + 6, feature, true);
}
