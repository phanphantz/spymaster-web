/**
 * Camera maths for the world map — pure functions, no DOM.
 *
 * The map is the flat lon/lat plane the Unity map uses (x = longitude, y = latitude, no
 * projection), viewed straight on. A camera is just a centre and a zoom, and the zoom is expressed
 * as CSS pixels per degree, so "how big is one lattice step on screen" is a single multiply.
 * Screen space is CSS pixels with y pointing down; latitude points up.
 */

export type BBox = readonly [west: number, south: number, east: number, north: number];

export interface Camera {
    lon: number;
    lat: number;
    /** CSS pixels per degree. Larger = more zoomed in. */
    ppd: number;
}

export interface Viewport {
    width: number;
    height: number;
}

/** Screen edges covered by UI — fitting and centring keep their target clear of these. */
export interface Insets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The pannable world. Antarctica is left out below -60°, and nothing lives above 85°. */
export const WORLD_BOUNDS: BBox = [-180, -60, 180, 85];

/** Closest zoom — about 4° across a 1000px screen, where the fine tier's 0.01° lattice is 2.5px. */
export const MAX_PPD = 250;

/** Furthest zoom: the whole world's width, but never so far out that the map is a thin strip in a
 *  tall viewport. Past the world's edges the ground is the same colour as the ocean, so a little
 *  overshoot on one axis reads as more sea rather than as the end of the map. */
export function minPpd(viewport: Viewport): number {
    return Math.max(viewport.width / 360, viewport.height / 180, 0.1);
}

export function worldToScreen(camera: Camera, viewport: Viewport, lon: number, lat: number): [number, number] {
    return [(lon - camera.lon) * camera.ppd + viewport.width / 2, (camera.lat - lat) * camera.ppd + viewport.height / 2];
}

export function screenToWorld(camera: Camera, viewport: Viewport, x: number, y: number): [number, number] {
    return [camera.lon + (x - viewport.width / 2) / camera.ppd, camera.lat - (y - viewport.height / 2) / camera.ppd];
}

/** What the camera sees, in degrees. */
export function visibleBounds(camera: Camera, viewport: Viewport): BBox {
    const halfW = viewport.width / 2 / camera.ppd;
    const halfH = viewport.height / 2 / camera.ppd;
    return [camera.lon - halfW, camera.lat - halfH, camera.lon + halfW, camera.lat + halfH];
}

/** Drag by a screen-space delta — the ground follows the pointer. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
    return { lon: camera.lon - dx / camera.ppd, lat: camera.lat + dy / camera.ppd, ppd: camera.ppd };
}

/** Zoom by `factor`, keeping the world point under screen point (x, y) where it is. */
export function zoomAround(camera: Camera, viewport: Viewport, x: number, y: number, factor: number): Camera {
    const [lon, lat] = screenToWorld(camera, viewport, x, y);
    const ppd = clampPpd(camera.ppd * factor, viewport);
    return {
        lon: lon - (x - viewport.width / 2) / ppd,
        lat: lat + (y - viewport.height / 2) / ppd,
        ppd,
    };
}

export function clampPpd(ppd: number, viewport: Viewport): number {
    return Math.min(MAX_PPD, Math.max(minPpd(viewport), ppd));
}

/** Keeps the view inside `bounds`: zoom inside its limits, and on each axis either the view stays
 *  within the bounds or — if the view is wider than the bounds — the bounds sit centred in it. */
export function clampCamera(camera: Camera, viewport: Viewport, bounds: BBox = WORLD_BOUNDS): Camera {
    const ppd = clampPpd(camera.ppd, viewport);
    const halfW = viewport.width / 2 / ppd;
    const halfH = viewport.height / 2 / ppd;
    const [west, south, east, north] = bounds;

    const lon = halfW * 2 >= east - west ? (west + east) / 2 : Math.min(east - halfW, Math.max(west + halfW, camera.lon));
    const lat = halfH * 2 >= north - south ? (south + north) / 2 : Math.min(north - halfH, Math.max(south + halfH, camera.lat));

    return { lon, lat, ppd };
}

/** The camera that shows `bbox` as large as fits in the part of the viewport not covered by
 *  `insets`, with `padding` pixels to spare on every side. */
export function fitBounds(bbox: BBox, viewport: Viewport, insets: Insets = NO_INSETS, padding = 32): Camera {
    const [west, south, east, north] = bbox;
    const availW = Math.max(40, viewport.width - insets.left - insets.right - padding * 2);
    const availH = Math.max(40, viewport.height - insets.top - insets.bottom - padding * 2);
    const ppd = clampPpd(Math.min(availW / Math.max(east - west, 1e-6), availH / Math.max(north - south, 1e-6)), viewport);
    return centreOn((west + east) / 2, (south + north) / 2, ppd, viewport, insets);
}

/** The camera at zoom `ppd` that puts (lon, lat) in the middle of the uncovered part of the viewport. */
export function centreOn(lon: number, lat: number, ppd: number, viewport: Viewport, insets: Insets = NO_INSETS): Camera {
    const clamped = clampPpd(ppd, viewport);
    const x = insets.left + (viewport.width - insets.left - insets.right) / 2;
    const y = insets.top + (viewport.height - insets.top - insets.bottom) / 2;
    return {
        lon: lon - (x - viewport.width / 2) / clamped,
        lat: lat + (y - viewport.height / 2) / clamped,
        ppd: clamped,
    };
}

/**
 * Interpolates between two cameras. Zoom moves geometrically, so a 16× zoom spends as long on each
 * doubling. The centre is not interpolated linearly in degrees — while zooming in, that makes the
 * target first drift *away* on screen (the zoom magnifies the remaining distance faster than the
 * centre closes it) and then snap in at the end. Instead the target's on-screen distance from the
 * centre shrinks linearly: remaining(t) = (1 − t) × remaining(0), in pixels. Zooming out is the same
 * path run backwards.
 */
export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
    const ppd = from.ppd * Math.pow(to.ppd / from.ppd, t);
    const w = to.ppd >= from.ppd ? 1 - ((1 - t) * from.ppd) / ppd : (t * to.ppd) / ppd;
    return {
        lon: from.lon + (to.lon - from.lon) * w,
        lat: from.lat + (to.lat - from.lat) * w,
        ppd,
    };
}

/**
 * The path for a fly-to. A short hop is a straight `lerpCamera`. A long one — where the two views
 * are further apart than fits on screen at the current zoom — pulls out until both ends are in view
 * and comes back in, rather than sliding a whole continent past at close zoom.
 */
export function flyPath(from: Camera, to: Camera, viewport: Viewport): (t: number) => Camera {
    const distance = Math.hypot(to.lon - from.lon, to.lat - from.lat);
    const span = Math.min(viewport.width, viewport.height) * 0.8;
    const overview = clampPpd(span / Math.max(distance, 1e-6), viewport);

    if (overview >= Math.min(from.ppd, to.ppd) * 0.8) return (t) => lerpCamera(from, to, t);

    const middle: Camera = { lon: (from.lon + to.lon) / 2, lat: (from.lat + to.lat) / 2, ppd: overview };
    return (t) => (t < 0.5 ? lerpCamera(from, middle, t * 2) : lerpCamera(middle, to, t * 2 - 1));
}

export function bboxOverlaps(a: BBox, b: BBox): boolean {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
