/**
 * Storage format for baked world-map geometry.
 *
 * Mirrors the Unity map (aoc-prototype `Assets/Scripts/WorldMap/`): polygons are simplified by
 * snapping every vertex to a shared lattice rather than by Ramer–Douglas–Peucker. RDP is a function
 * of the whole ring, so two neighbours sharing a border keep different vertices from it and the
 * border splits into sliver gaps and overlaps. Snapping is a pure per-point function, so identical
 * input vertices always land on identical output vertices and shared borders stay welded by
 * construction. Never run a path-dependent simplification after this — it reintroduces exactly that
 * divergence.
 *
 * Coordinates are stored as integer lattice steps (`unitDeg` degrees each), delta-chained across the
 * whole layer and written as zigzag varints — small, and gzip squeezes the rest.
 *
 *   magic 'SMAP' (4 bytes) · version · unit in micro-degrees · shape count
 *   per shape:  part count
 *   per part:   ring count            (ring 0 is the outer ring, the rest are holes)
 *   per ring:   point count, then dx dy per point
 */

/** One feature's geometry: parts (polygons), each an outer ring followed by its holes, each ring a
 *  flat `[x0, y0, x1, y1, …]` run of lattice coordinates. Rings are implicitly closed — the closing
 *  point is never repeated. A shape can be empty: a feature too small to survive a coarse lattice. */
export type GeoShape = Int32Array[][];

export interface GeoLayer {
    /** Degrees per lattice step — x is longitude, y is latitude (the same flat lon/lat plane the Unity
     *  map uses). */
    unitDeg: number;
    /** One entry per feature, in the same order as the map index. */
    shapes: GeoShape[];
}

const MAGIC = [0x53, 0x4d, 0x41, 0x50]; // 'SMAP'
const VERSION = 1;

/**
 * Snaps a ring onto the lattice (`round(v / divisor)`), drops points that collapsed onto their
 * predecessor, and drops a tail that collapsed back onto the head (a GeoJSON ring repeats its first
 * point at the end; snapping can also re-create that). Works both for raw lon/lat (divisor = the
 * lattice step in degrees) and for re-snapping an already-snapped ring onto a coarser lattice
 * (divisor = the integer ratio between the two).
 *
 * Returns undefined when fewer than 3 distinct points survive. Unity falls back to the unsnapped ring
 * there; here the ring is dropped instead, because a tier is only drawn at zooms where one lattice
 * step is about a pixel, so anything that collapses is already sub-pixel.
 */
export function snapRing(coords: ArrayLike<number>, divisor: number): Int32Array | undefined {
    const pointCount = Math.floor(coords.length / 2);
    const out = new Int32Array(pointCount * 2);
    let count = 0;

    for (let i = 0; i < pointCount; i++) {
        const x = Math.round(coords[i * 2] / divisor);
        const y = Math.round(coords[i * 2 + 1] / divisor);
        if (count > 0 && out[count * 2 - 2] === x && out[count * 2 - 1] === y) continue;
        out[count * 2] = x;
        out[count * 2 + 1] = y;
        count++;
    }

    while (count > 1 && out[count * 2 - 2] === out[0] && out[count * 2 - 1] === out[1]) count--;

    return count < 3 ? undefined : out.slice(0, count * 2);
}

/** Snaps one polygon (outer ring, then holes). A collapsed outer ring takes the whole part with it —
 *  holes mean nothing without it; a collapsed hole is simply dropped. */
export function snapPart(rings: readonly ArrayLike<number>[], divisor: number): Int32Array[] | undefined {
    const outer = snapRing(rings[0], divisor);
    if (!outer) return undefined;

    const part = [outer];
    for (let r = 1; r < rings.length; r++) {
        const hole = snapRing(rings[r], divisor);
        if (hole) part.push(hole);
    }
    return part;
}

/**
 * Derives a coarser tier from an existing layer by re-snapping every ring onto a lattice `factor`
 * times wider. Re-snapping is still a pure per-point function of the stored coordinates, so borders
 * that were welded at the finer tier stay welded at the coarser one.
 */
export function coarsen(layer: GeoLayer, factor: number): GeoLayer {
    if (!Number.isInteger(factor) || factor < 1) throw new Error(`coarsen factor must be a positive integer, got ${factor}`);

    return {
        unitDeg: layer.unitDeg * factor,
        shapes: layer.shapes.map((shape) => {
            const parts: GeoShape = [];
            for (const part of shape) {
                const snapped = snapPart(part, factor);
                if (snapped) parts.push(snapped);
            }
            return parts;
        }),
    };
}

/**
 * Undoes the bake's gzip. The files ship pre-gzipped because static hosts (GitHub Pages included)
 * won't compress an arbitrary binary type on the fly. A host that *does* label them
 * `Content-Encoding: gzip` gets them inflated by the browser before this runs, so the gzip magic is
 * checked rather than assumed.
 */
export async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function encodeLayer(layer: GeoLayer): Uint8Array<ArrayBuffer> {
    const writer = new VarintWriter();
    for (const byte of MAGIC) writer.byte(byte);
    writer.uint(VERSION);
    writer.uint(Math.round(layer.unitDeg * 1e6));
    writer.uint(layer.shapes.length);

    let prevX = 0;
    let prevY = 0;
    for (const shape of layer.shapes) {
        writer.uint(shape.length);
        for (const part of shape) {
            writer.uint(part.length);
            for (const ring of part) {
                const pointCount = ring.length / 2;
                writer.uint(pointCount);
                for (let i = 0; i < pointCount; i++) {
                    const x = ring[i * 2];
                    const y = ring[i * 2 + 1];
                    writer.int(x - prevX);
                    writer.int(y - prevY);
                    prevX = x;
                    prevY = y;
                }
            }
        }
    }

    return writer.finish();
}

export function decodeLayer(bytes: Uint8Array): GeoLayer {
    for (let i = 0; i < MAGIC.length; i++) {
        if (bytes[i] !== MAGIC[i]) throw new Error('Not a baked map layer (bad magic)');
    }

    const reader = new VarintReader(bytes, MAGIC.length);
    const version = reader.uint();
    if (version !== VERSION) throw new Error(`Unsupported map layer version ${version}`);

    const unitDeg = reader.uint() / 1e6;
    const shapeCount = reader.uint();
    const shapes: GeoShape[] = new Array(shapeCount);

    let x = 0;
    let y = 0;
    for (let s = 0; s < shapeCount; s++) {
        const partCount = reader.uint();
        const shape: GeoShape = new Array(partCount);
        for (let p = 0; p < partCount; p++) {
            const ringCount = reader.uint();
            const part: Int32Array[] = new Array(ringCount);
            for (let r = 0; r < ringCount; r++) {
                const pointCount = reader.uint();
                const ring = new Int32Array(pointCount * 2);
                for (let i = 0; i < pointCount; i++) {
                    x += reader.int();
                    y += reader.int();
                    ring[i * 2] = x;
                    ring[i * 2 + 1] = y;
                }
                part[r] = ring;
            }
            shape[p] = part;
        }
        shapes[s] = shape;
    }

    return { unitDeg, shapes };
}

class VarintWriter {
    private buffer = new Uint8Array(new ArrayBuffer(1 << 16));
    private length = 0;

    byte(value: number): void {
        if (this.length === this.buffer.length) {
            const grown = new Uint8Array(this.buffer.length * 2);
            grown.set(this.buffer);
            this.buffer = grown;
        }
        this.buffer[this.length++] = value;
    }

    uint(value: number): void {
        while (value >= 0x80) {
            this.byte((value & 0x7f) | 0x80);
            value = Math.floor(value / 0x80);
        }
        this.byte(value);
    }

    /** Zigzag, so small negative deltas stay one byte. */
    int(value: number): void {
        this.uint(value >= 0 ? value * 2 : -value * 2 - 1);
    }

    finish(): Uint8Array<ArrayBuffer> {
        return this.buffer.slice(0, this.length);
    }
}

class VarintReader {
    constructor(
        private readonly bytes: Uint8Array,
        private offset: number,
    ) {}

    uint(): number {
        let value = 0;
        let scale = 1;
        for (;;) {
            if (this.offset >= this.bytes.length) throw new Error('Map layer truncated');
            const byte = this.bytes[this.offset++];
            value += (byte & 0x7f) * scale;
            if (byte < 0x80) return value;
            scale *= 0x80;
        }
    }

    int(): number {
        const zigzag = this.uint();
        return zigzag % 2 === 0 ? zigzag / 2 : -(zigzag + 1) / 2;
    }
}
