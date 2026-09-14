import { describe, expect, it } from 'vitest';
import type { GeoLayer } from './geoCodec';
import { FeaturePicker } from './hitTest';
import { MITER_LIMIT, VERTEX_STRIDE, buildTierMesh, miter } from './meshBuilder';

const ring = (...points: number[]) => Int32Array.from(points);

// Feature 0: a 10×10 square with a 2×2 hole. Feature 1: empty (collapsed at this tier).
// Feature 2: two separate triangles.
const layer: GeoLayer = {
    unitDeg: 1,
    shapes: [
        [[ring(0, 0, 10, 0, 10, 10, 0, 10), ring(4, 4, 6, 4, 6, 6, 4, 6)]],
        [],
        [[ring(20, 0, 22, 0, 21, 2)], [ring(30, 0, 32, 0, 31, 2)]],
    ],
};

describe('buildTierMesh', () => {
    const mesh = buildTierMesh(layer);
    const view = new DataView(mesh.vertices);
    const vertex = (index: number) => ({
        x: view.getInt16(index * VERTEX_STRIDE, true),
        y: view.getInt16(index * VERTEX_STRIDE + 2, true),
        ox: view.getInt8(index * VERTEX_STRIDE + 4),
        oy: view.getInt8(index * VERTEX_STRIDE + 5),
        feature: view.getUint16(index * VERTEX_STRIDE + 6, true),
    });

    it('lays down two vertices per ring point, mirrored offsets, tagged with their feature', () => {
        expect(mesh.vertices.byteLength).toBe((8 + 6) * 2 * VERTEX_STRIDE);
        const even = vertex(0);
        const odd = vertex(1);
        expect([even.x, even.y]).toEqual([0, 0]);
        expect([odd.x, odd.y]).toEqual([0, 0]);
        expect(odd.ox).toBe(-even.ox);
        expect(odd.oy).toBe(-even.oy);
        expect(vertex(16).feature).toBe(2);
    });

    it('triangulates fills over even vertices, respecting holes', () => {
        const [first, count] = mesh.fillRanges.slice(0, 2);
        // A square with a square hole: 8 points + 2 × 1 hole − 2 = 8 triangles.
        expect(count).toBe(8 * 3);
        for (let i = first; i < first + count; i++) expect(mesh.fillIndices[i] % 2).toBe(0);
    });

    it('gives an empty feature empty ranges without breaking the ones after it', () => {
        expect(mesh.fillRanges[3]).toBe(0);
        expect(mesh.borderRanges[3]).toBe(0);
        expect(mesh.fillRanges[5]).toBe(2 * 3);
        expect(mesh.borderRanges[5]).toBe(6 * 6);
        expect(mesh.fillRanges[4]).toBe(mesh.fillRanges[1]);
    });

    it('strings a closed ribbon around every ring', () => {
        const [first, count] = mesh.borderRanges.slice(0, 2);
        expect(count).toBe((4 + 4) * 6);
        // The last quad of the outer ring wraps back to its first point.
        const lastQuad = Array.from(mesh.borderIndices.slice(first + 3 * 6, first + 4 * 6));
        expect(lastQuad).toEqual([6, 7, 0, 7, 1, 0]);
    });
});

describe('miter', () => {
    it('is the plain normal along a straight run', () => {
        const [mx, my] = miter([0, 0, 5, 0, 10, 0], 1, 3);
        expect(mx).toBeCloseTo(0);
        expect(my).toBeCloseTo(1);
    });

    it('lengthens to √2 at a right angle', () => {
        const [mx, my] = miter([0, 0, 10, 0, 10, 10, 0, 10], 1, 4);
        expect(Math.hypot(mx, my)).toBeCloseTo(Math.SQRT2);
    });

    it('is clamped at a needle-sharp corner', () => {
        const [mx, my] = miter([0, 0, 100, 1, 0, 2], 1, 3);
        expect(Math.hypot(mx, my)).toBeLessThanOrEqual(MITER_LIMIT + 1e-9);
    });
});

describe('FeaturePicker', () => {
    const picker = new FeaturePicker(layer);

    it('finds the feature under a point', () => {
        expect(picker.pick(1, 1)).toBe(0);
        expect(picker.pick(31, 0.5)).toBe(2);
    });

    it('treats a hole as open sea', () => {
        expect(picker.pick(5, 5)).toBe(-1);
    });

    it('misses outside every feature', () => {
        expect(picker.pick(15, 5)).toBe(-1);
    });

    it('works in degrees against a coarser lattice', () => {
        const coarse = new FeaturePicker({ unitDeg: 0.5, shapes: layer.shapes });
        expect(coarse.pick(0.5, 0.5)).toBe(0);
        expect(coarse.pick(2.5, 2.5)).toBe(-1); // lattice (5, 5): the hole
    });
});
