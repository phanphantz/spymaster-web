import {
    centreOn,
    clampCamera,
    fitBounds,
    flyPath,
    minPpd,
    panBy,
    screenToWorld,
    worldToScreen,
    zoomAround,
    type Camera,
    type Insets,
    type Viewport,
} from './camera';
import { attachMapInput } from './mapInput';
import { MAP_FILES, type MapFeature, type MapIndex, type TierName } from './mapIndex';
import { MapRenderer } from './mapRenderer';
import type { MapWorkerRequest, MapWorkerResponse } from './mapWorkerProtocol';
import type { TierMesh } from './meshBuilder';

export interface WorldMapOptions {
    /** Prefix for the baked files — `import.meta.env.BASE_URL` in the app. */
    baseUrl: string;
    /** Screen edges currently covered by UI, so a fly-to lands its target in the clear. */
    insets?: () => Insets;
}

type Listener<T extends unknown[]> = (...args: T) => void;

interface Listeners {
    /** After every drawn frame — overlays re-project against the new camera here. */
    frame: Listener<[]>;
    /** The country under the mouse changed (-1 for sea), with the cursor position. */
    hover: Listener<[feature: number, x: number, y: number]>;
    select: Listener<[feature: number]>;
    ready: Listener<[]>;
}

type Motion =
    | { kind: 'fly'; path: (t: number) => Camera; start: number; duration: number }
    | { kind: 'glide'; vx: number; vy: number; last: number };

/** How fast a released drag slows down — the glide's velocity falls by 1/e every this many seconds. */
const GLIDE_DECAY_S = 0.3;
/** Mission pins frame their region at least this close. */
const POINT_FOCUS_PPD = 28;
const MAX_PIXEL_RATIO = 2;

/**
 * The world map: owns the canvas, camera, gestures, geometry worker and renderer, and exposes the
 * handful of things the game UI needs — fly to a feature or a point, project a lon/lat for an
 * overlay, and hear about hover / select.
 *
 * Deliberately outside React. The game store bumps its version every clock tick, and nothing about
 * panning a map should ride on that; the React wrapper only mounts this and listens.
 */
export class WorldMap {
    camera: Camera = { lon: 10, lat: 20, ppd: 1 };
    viewport: Viewport = { width: 1, height: 1 };
    features: MapFeature[] = [];
    hover = -1;
    selected = -1;

    private renderer?: MapRenderer;
    private readonly worker: Worker;
    private readonly meshes = new Map<TierName, TierMesh>();
    private readonly listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = {
        frame: new Set(),
        hover: new Set(),
        select: new Set(),
        ready: new Set(),
    };
    private readonly detachInput: () => void;
    private readonly resizeObserver: ResizeObserver;
    private motion?: Motion;
    private frameRequest = 0;
    private disposed = false;
    private pickSeq = 0;
    private readonly picks = new Map<number, (feature: number) => void>();
    private hoverInFlight = false;
    private hoverQueued?: [number, number];

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly options: WorldMapOptions,
    ) {
        this.worker = new Worker(new URL('./map.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<MapWorkerResponse>) => this.onWorkerMessage(event.data);

        this.detachInput = attachMapInput(canvas, {
            grab: () => {
                this.motion = undefined;
            },
            pan: (dx, dy) => this.setCamera(panBy(this.camera, dx, dy)),
            zoom: (x, y, factor) => this.setCamera(zoomAround(this.camera, this.viewport, x, y, factor)),
            release: (vx, vy) => {
                if (Math.hypot(vx, vy) > 60) this.startMotion({ kind: 'glide', vx, vy, last: performance.now() });
            },
            tap: (x, y) => this.onTap(x, y),
            hover: (x, y) => this.onHover(x, y),
            leave: () => this.setHover(-1, 0, 0),
        });

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);

        canvas.addEventListener('webglcontextlost', this.onContextLost);
        canvas.addEventListener('webglcontextrestored', this.onContextRestored);

        this.resize();
        this.camera = clampCamera({ ...this.camera, ppd: minPpd(this.viewport) }, this.viewport);
        void this.load();
    }

    on<K extends keyof Listeners>(event: K, listener: Listeners[K]): () => void {
        (this.listeners[event] as Set<Listeners[K]>).add(listener);
        return () => (this.listeners[event] as Set<Listeners[K]>).delete(listener);
    }

    /** Screen position (CSS px, relative to the canvas) of a lon/lat under the current camera. */
    project(lon: number, lat: number): [number, number] {
        return worldToScreen(this.camera, this.viewport, lon, lat);
    }

    /** Fly to frame a country's main landmass, and mark it selected. */
    focusFeature(feature: number): void {
        const target = this.features[feature];
        if (!target) return;
        this.select(feature);
        this.flyTo(fitBounds(target.focus, this.viewport, this.insets()));
    }

    /** Fly to centre a point — a mission's location — zooming in to at least country scale. Drops
     *  the selected country, which would otherwise stay named while the map shows somewhere else. */
    focusPoint(lon: number, lat: number): void {
        this.select(-1);
        this.flyTo(centreOn(lon, lat, Math.max(this.camera.ppd, POINT_FOCUS_PPD), this.viewport, this.insets()));
    }

    select(feature: number): void {
        if (feature === this.selected) return;
        this.selected = feature;
        this.emit('select', feature);
        this.requestFrame();
    }

    flyTo(target: Camera): void {
        const to = clampCamera(target, this.viewport);
        const path = flyPath(this.camera, to, this.viewport);
        const zoomSteps = Math.abs(Math.log2(to.ppd / this.camera.ppd));
        const travel = Math.hypot(to.lon - this.camera.lon, to.lat - this.camera.lat) * Math.min(this.camera.ppd, to.ppd);
        const duration = Math.min(1400, 450 + zoomSteps * 120 + Math.min(travel, 2000) * 0.15);
        this.startMotion({ kind: 'fly', path, start: performance.now(), duration });
    }

    dispose(): void {
        this.disposed = true;
        cancelAnimationFrame(this.frameRequest);
        this.detachInput();
        this.resizeObserver.disconnect();
        this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
        this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
        this.worker.terminate();
        this.renderer?.dispose();
        this.renderer = undefined;
        for (const set of Object.values(this.listeners)) set.clear();
    }

    private async load(): Promise<void> {
        const url = (path: string) => new URL(this.options.baseUrl + path, location.href).href;
        this.post({ type: 'load', coarseUrl: url(MAP_FILES.coarse), fineUrl: url(MAP_FILES.fine) });

        try {
            const response = await fetch(url(MAP_FILES.index));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const index = (await response.json()) as MapIndex;
            if (this.disposed) return;
            this.features = index.features;
            this.createRenderer();
        } catch (error) {
            console.error('World map index failed to load', error);
        }
    }

    private createRenderer(): void {
        try {
            this.renderer = MapRenderer.create(this.canvas, this.features);
        } catch (error) {
            console.error('World map renderer failed to start', error);
        }
        if (!this.renderer) return;
        this.resize();
        for (const [tier, mesh] of this.meshes) this.renderer.upload(tier, mesh);
        this.meshes.clear();
        this.requestFrame();
        this.emit('ready');
    }

    private onWorkerMessage(message: MapWorkerResponse): void {
        switch (message.type) {
            case 'tier':
                // Held until the renderer exists (the index and the tiers race), then dropped —
                // the GPU copy is the only one kept.
                if (this.renderer) {
                    this.renderer.upload(message.tier, message.mesh);
                    this.requestFrame();
                } else {
                    this.meshes.set(message.tier, message.mesh);
                }
                break;
            case 'picked':
                this.picks.get(message.id)?.(message.feature);
                this.picks.delete(message.id);
                break;
            case 'error':
                console.error('World map geometry failed to load:', message.message);
                break;
        }
    }

    private post(message: MapWorkerRequest): void {
        this.worker.postMessage(message);
    }

    private pick(x: number, y: number, done: (feature: number) => void): void {
        const [lon, lat] = screenToWorld(this.camera, this.viewport, x, y);
        const id = ++this.pickSeq;
        this.picks.set(id, done);
        this.post({ type: 'pick', id, lon, lat });
    }

    private onTap(x: number, y: number): void {
        this.pick(x, y, (feature) => {
            if (feature < 0) this.select(-1);
            else this.focusFeature(feature);
        });
    }

    /** One hover pick in flight at a time; a move while it's out just updates the queued position,
     *  so a fast mouse costs one pick per round trip rather than one per event. */
    private onHover(x: number, y: number): void {
        if (this.hoverInFlight) {
            this.hoverQueued = [x, y];
            return;
        }
        this.hoverInFlight = true;
        this.pick(x, y, (feature) => {
            this.hoverInFlight = false;
            this.setHover(feature, x, y);
            const queued = this.hoverQueued;
            this.hoverQueued = undefined;
            if (queued) this.onHover(queued[0], queued[1]);
        });
    }

    private setHover(feature: number, x: number, y: number): void {
        const changed = feature !== this.hover;
        this.hover = feature;
        this.emit('hover', feature, x, y);
        if (changed) this.requestFrame();
    }

    private setCamera(camera: Camera): void {
        this.camera = clampCamera(camera, this.viewport);
        this.requestFrame();
    }

    private startMotion(motion: Motion): void {
        this.motion = motion;
        this.requestFrame();
    }

    private requestFrame(): void {
        if (this.frameRequest || this.disposed) return;
        this.frameRequest = requestAnimationFrame((now) => this.frame(now));
    }

    private frame(now: number): void {
        this.frameRequest = 0;
        this.advanceMotion(now);
        this.draw();
        if (this.motion) this.requestFrame();
    }

    private draw(): void {
        this.renderer?.draw(this.camera, this.viewport, this.hover, this.selected);
        this.emit('frame');
    }

    private advanceMotion(now: number): void {
        const motion = this.motion;
        if (!motion) return;

        if (motion.kind === 'fly') {
            const t = Math.min(1, (now - motion.start) / motion.duration);
            this.camera = clampCamera(motion.path(easeInOutCubic(t)), this.viewport);
            if (t >= 1) this.motion = undefined;
            return;
        }

        const dt = Math.min(0.05, (now - motion.last) / 1000);
        motion.last = now;
        this.camera = clampCamera(panBy(this.camera, motion.vx * dt, motion.vy * dt), this.viewport);
        const decay = Math.exp(-dt / GLIDE_DECAY_S);
        motion.vx *= decay;
        motion.vy *= decay;
        if (Math.hypot(motion.vx, motion.vy) < 15) this.motion = undefined;
    }

    private resize(): void {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        if (width === 0 || height === 0) return;
        this.viewport = { width, height };
        this.renderer?.resize(width, height, Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
        this.camera = clampCamera(this.camera, this.viewport);
        // Drawn now rather than next frame: resizing the canvas clears it, and a blank frame
        // flashes while a window is dragged.
        this.draw();
    }

    private insets(): Insets {
        return this.options.insets?.() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    }

    private readonly onContextLost = (event: Event) => {
        event.preventDefault();
        this.renderer = undefined;
    };

    private readonly onContextRestored = () => {
        this.createRenderer();
        this.post({ type: 'rebuild' });
    };

    private emit<K extends keyof Listeners>(event: K, ...args: Parameters<Listeners[K]>): void {
        for (const listener of this.listeners[event]) (listener as (...a: Parameters<Listeners[K]>) => void)(...args);
    }
}

function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Screen edges covered by UI, read from every element marked `data-map-occluder`. A marked element
 * wider than most of the screen is a band across the top or bottom (the top bar, the roster, a
 * phone-width panel); anything narrower covers the side it sits nearer (the contracts panel on a
 * desktop).
 */
export function occluderInsets(viewport: Viewport): Insets {
    const insets = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const element of document.querySelectorAll<HTMLElement>('[data-map-occluder]')) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width > viewport.width * 0.6) {
            if (rect.top + rect.height / 2 < viewport.height / 2) insets.top = Math.max(insets.top, rect.bottom);
            else insets.bottom = Math.max(insets.bottom, viewport.height - rect.top);
        } else if (rect.left + rect.width / 2 > viewport.width / 2) {
            insets.right = Math.max(insets.right, viewport.width - rect.left);
        } else {
            insets.left = Math.max(insets.left, rect.right);
        }
    }
    return insets;
}
