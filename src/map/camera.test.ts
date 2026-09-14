import { describe, expect, it } from 'vitest';
import {
    MAX_PPD,
    centreOn,
    clampCamera,
    fitBounds,
    flyPath,
    lerpCamera,
    minPpd,
    panBy,
    screenToWorld,
    worldToScreen,
    zoomAround,
    type Camera,
} from './camera';

const viewport = { width: 1000, height: 600 };

describe('screen ↔ world', () => {
    it('are inverses, with latitude pointing up', () => {
        const camera: Camera = { lon: 10, lat: 45, ppd: 20 };
        const [x, y] = worldToScreen(camera, viewport, 12, 46);
        expect(x).toBeCloseTo(540);
        expect(y).toBeCloseTo(280);

        const [lon, lat] = screenToWorld(camera, viewport, x, y);
        expect(lon).toBeCloseTo(12);
        expect(lat).toBeCloseTo(46);
    });
});

describe('panBy', () => {
    it('moves the ground with the pointer', () => {
        const camera = panBy({ lon: 0, lat: 0, ppd: 10 }, 100, 50);
        // Dragging right and down reveals what was to the left and above.
        expect(camera.lon).toBeCloseTo(-10);
        expect(camera.lat).toBeCloseTo(5);
    });
});

describe('zoomAround', () => {
    it('keeps the world point under the cursor fixed', () => {
        const camera: Camera = { lon: 0, lat: 20, ppd: 10 };
        const before = screenToWorld(camera, viewport, 800, 100);
        const zoomed = zoomAround(camera, viewport, 800, 100, 3);

        expect(zoomed.ppd).toBeCloseTo(30);
        const after = screenToWorld(zoomed, viewport, 800, 100);
        expect(after[0]).toBeCloseTo(before[0]);
        expect(after[1]).toBeCloseTo(before[1]);
    });

    it('stops at the zoom limits', () => {
        expect(zoomAround({ lon: 0, lat: 0, ppd: 200 }, viewport, 500, 300, 10).ppd).toBe(MAX_PPD);
        expect(zoomAround({ lon: 0, lat: 0, ppd: 5 }, viewport, 500, 300, 0.01).ppd).toBe(minPpd(viewport));
    });
});

describe('clampCamera', () => {
    it('keeps the view inside the world when zoomed in', () => {
        const camera = clampCamera({ lon: 179, lat: 84, ppd: 50 }, viewport);
        // 10° either side of centre at this zoom, 6° above and below.
        expect(camera.lon).toBeCloseTo(170);
        expect(camera.lat).toBeCloseTo(79);
    });

    it('centres an axis the view is wider than', () => {
        const camera = clampCamera({ lon: 100, lat: 40, ppd: minPpd(viewport) }, viewport);
        expect(camera.lat).toBeCloseTo(12.5); // middle of -60..85
    });
});

describe('fitBounds', () => {
    it('fits the box inside the uncovered part of the screen', () => {
        const insets = { top: 60, right: 400, bottom: 100, left: 0 };
        const camera = fitBounds([0, 0, 20, 10], viewport, insets, 0);

        // 600 × 440 px available: width-limited at 30 px per degree.
        expect(camera.ppd).toBeCloseTo(30);

        // The box centre lands in the middle of the uncovered area.
        const [x, y] = worldToScreen(camera, viewport, 10, 5);
        expect(x).toBeCloseTo(300);
        expect(y).toBeCloseTo(280);
    });

    it('does not zoom past the limit for a tiny feature', () => {
        expect(fitBounds([7.4, 43.7, 7.44, 43.75], viewport).ppd).toBe(MAX_PPD);
    });
});

describe('centreOn', () => {
    it('puts the point in the middle of the uncovered area', () => {
        const camera = centreOn(8.54, 47.37, 40, viewport, { top: 0, right: 200, bottom: 0, left: 0 });
        const [x, y] = worldToScreen(camera, viewport, 8.54, 47.37);
        expect(x).toBeCloseTo(400);
        expect(y).toBeCloseTo(300);
    });
});

describe('lerpCamera', () => {
    it('hits both ends exactly', () => {
        const from: Camera = { lon: 0, lat: 0, ppd: 5 };
        const to: Camera = { lon: 20, lat: 10, ppd: 80 };
        expect(lerpCamera(from, to, 0)).toEqual(from);
        const end = lerpCamera(from, to, 1);
        expect(end.lon).toBeCloseTo(20);
        expect(end.lat).toBeCloseTo(10);
        expect(end.ppd).toBeCloseTo(80);
    });

    it('closes the on-screen distance to the target steadily while zooming in', () => {
        const from: Camera = { lon: 0, lat: 0, ppd: 5 };
        const to: Camera = { lon: 20, lat: 0, ppd: 80 };
        const onScreen = (t: number) => {
            const camera = lerpCamera(from, to, t);
            return (to.lon - camera.lon) * camera.ppd;
        };
        expect(onScreen(0.5)).toBeCloseTo(onScreen(0) / 2);
        expect(onScreen(0.75)).toBeCloseTo(onScreen(0) / 4);
    });

    it('zooms geometrically, and zooming out never runs the centre backwards', () => {
        const from: Camera = { lon: 20, lat: 0, ppd: 80 };
        const to: Camera = { lon: 0, lat: 0, ppd: 5 };
        expect(lerpCamera(from, to, 0.5).ppd).toBeCloseTo(20);

        let last = from.lon;
        for (let t = 0.1; t <= 1; t += 0.1) {
            const lon = lerpCamera(from, to, t).lon;
            expect(lon).toBeLessThanOrEqual(last + 1e-9);
            last = lon;
        }
    });
});

describe('flyPath', () => {
    it('pulls out for a hop longer than the screen', () => {
        const zurich: Camera = { lon: 8.5, lat: 47.4, ppd: 100 };
        const hongKong: Camera = { lon: 114.2, lat: 22.3, ppd: 100 };
        const path = flyPath(zurich, hongKong, viewport);
        expect(path(0.5).ppd).toBeLessThan(10);
        expect(path(1).lon).toBeCloseTo(114.2);
    });

    it('stays a straight lerp for a short hop', () => {
        const a: Camera = { lon: 0, lat: 0, ppd: 20 };
        const b: Camera = { lon: 5, lat: 0, ppd: 20 };
        expect(flyPath(a, b, viewport)(0.5).lon).toBeCloseTo(2.5);
    });
});
