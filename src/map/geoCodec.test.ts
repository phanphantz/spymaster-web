import { describe, expect, it } from 'vitest';
import { coarsen, decodeLayer, encodeLayer, inflate, snapPart, snapRing, type GeoLayer } from './geoCodec';

const ring = (...points: number[]) => Int32Array.from(points);

describe('snapRing', () => {
    it('snaps to the lattice and drops the GeoJSON closing point', () => {
        const snapped = snapRing([0.04, 0.01, 1.02, -0.03, 1.01, 0.98, 0.02, 1.04, 0.04, 0.01], 1);
        expect(Array.from(snapped!)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    });

    it('drops points that collapse onto their predecessor', () => {
        const snapped = snapRing([0, 0, 0.1, 0.1, 2, 0, 2.1, 0.2, 2, 2, 0, 2], 1);
        expect(Array.from(snapped!)).toEqual([0, 0, 2, 0, 2, 2, 0, 2]);
    });

    it('drops a tail that collapses back onto the head', () => {
        const snapped = snapRing([0, 0, 4, 0, 4, 4, 0.2, 0.1, 0.1, 0.3], 1);
        expect(Array.from(snapped!)).toEqual([0, 0, 4, 0, 4, 4]);
    });

    it('gives up on a ring that collapses below a triangle', () => {
        expect(snapRing([0, 0, 0.2, 0, 0.2, 0.2, 0, 0.2], 1)).toBeUndefined();
    });

    it('is a pure per-point function, so a shared border stays welded', () => {
        // Two squares sharing the edge x = 1, walked from different start points and directions.
        const left = snapRing([0, 0, 1.01, 0.02, 1.01, 0.52, 0.98, 1.01, 0, 1], 0.5)!;
        const right = snapRing([2, 1, 0.98, 1.01, 1.01, 0.52, 1.01, 0.02, 2, 0], 0.5)!;

        const points = (r: Int32Array) => Array.from({ length: r.length / 2 }, (_, i) => `${r[i * 2]},${r[i * 2 + 1]}`);
        const shared = points(left).filter((point) => points(right).includes(point));
        expect(shared).toEqual(['2,0', '2,1', '2,2']);
    });
});

describe('snapPart', () => {
    it('loses the whole part when the outer ring collapses', () => {
        expect(snapPart([[0, 0, 0.1, 0, 0.1, 0.1], [0, 0, 0.05, 0, 0.05, 0.05]], 1)).toBeUndefined();
    });

    it('keeps the outer ring when only a hole collapses', () => {
        const part = snapPart([[0, 0, 10, 0, 10, 10, 0, 10], [5, 5, 5.1, 5, 5.1, 5.1]], 1)!;
        expect(part).toHaveLength(1);
    });
});

describe('encode / decode', () => {
    it('round-trips shapes, including negatives, holes and empty shapes', () => {
        const layer: GeoLayer = {
            unitDeg: 0.01,
            shapes: [
                [[ring(-18000, -6000, 18000, -6000, 18000, 8500, -18000, 8500), ring(-10, -10, 10, -10, 10, 10)]],
                [],
                [[ring(1, 1, 2, 1, 2, 2)], [ring(100, 100, 101, 100, 101, 101, 100, 101)]],
            ],
        };

        const decoded = decodeLayer(encodeLayer(layer));
        expect(decoded.unitDeg).toBeCloseTo(0.01, 9);
        expect(decoded.shapes.map((shape) => shape.map((part) => part.map((r) => Array.from(r))))).toEqual(
            layer.shapes.map((shape) => shape.map((part) => part.map((r) => Array.from(r)))),
        );
    });

    it('rejects bytes that are not a map layer', () => {
        expect(() => decodeLayer(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/magic/);
    });
});

describe('inflate', () => {
    const layer: GeoLayer = { unitDeg: 0.4, shapes: [[[ring(0, 0, 3, 0, 3, 3)]]] };

    it('gunzips a pre-gzipped file', async () => {
        const encoded = encodeLayer(layer);
        const gzipped = new Uint8Array(await new Response(new Blob([encoded]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
        expect(Array.from(await inflate(gzipped))).toEqual(Array.from(encoded));
    });

    it('passes through bytes the host already inflated', async () => {
        const encoded = encodeLayer(layer);
        expect(await inflate(encoded)).toBe(encoded);
    });
});

describe('coarsen', () => {
    it('re-snaps onto a wider lattice and scales the unit', () => {
        const fine: GeoLayer = {
            unitDeg: 0.01,
            shapes: [[[ring(0, 0, 1000, 0, 1004, 996, 0, 1000)]], [[ring(0, 0, 3, 0, 3, 3)]]],
        };
        const coarse = coarsen(fine, 10);

        expect(coarse.unitDeg).toBeCloseTo(0.1, 9);
        expect(Array.from(coarse.shapes[0][0][0])).toEqual([0, 0, 100, 0, 100, 100, 0, 100]);
        // Too small for the wider lattice — the feature stays in the list, just empty.
        expect(coarse.shapes[1]).toEqual([]);
    });
});
