/**
 * Pointer gestures for the map canvas: one-finger / mouse drag pans, two-finger pinch zooms and pans
 * around the pinch midpoint, the wheel zooms at the cursor, and a press that barely moves is a tap.
 * Everything is reported in element-local CSS pixels; what a pan or zoom *means* is the owner's
 * business.
 */
export interface MapInputHandlers {
    /** A gesture began — stop any glide or fly-to so the ground is under the player's finger. */
    grab(): void;
    pan(dx: number, dy: number): void;
    zoom(x: number, y: number, factor: number): void;
    /** The last finger lifted after a drag, moving at (vx, vy) px/s — (0, 0) after a pinch. */
    release(vx: number, vy: number): void;
    tap(x: number, y: number): void;
    /** A mouse moving over the map with no button held. */
    hover(x: number, y: number): void;
    leave(): void;
}

/** Further than this and a press is a drag, not a tap. */
const TAP_SLOP_PX = 6;
const TAP_MAX_MS = 500;
/** Release velocity is measured over the last stretch of the drag, not the whole of it. */
const VELOCITY_WINDOW_MS = 100;

export function attachMapInput(element: HTMLElement, handlers: MapInputHandlers): () => void {
    const pointers = new Map<number, { x: number; y: number }>();
    let tap: { x: number; y: number; time: number } | undefined;
    let samples: { time: number; x: number; y: number }[] = [];

    const local = (event: { clientX: number; clientY: number }): [number, number] => {
        const rect = element.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    };

    const onPointerDown = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const [x, y] = local(event);
        element.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x, y });
        samples = [];
        tap = pointers.size === 1 ? { x, y, time: event.timeStamp } : undefined;
        handlers.grab();
    };

    const onPointerMove = (event: PointerEvent) => {
        const [x, y] = local(event);
        const previous = pointers.get(event.pointerId);
        if (!previous) {
            if (event.pointerType === 'mouse') handlers.hover(x, y);
            return;
        }

        if (pointers.size === 1) {
            handlers.pan(x - previous.x, y - previous.y);
            samples.push({ time: event.timeStamp, x, y });
            while (samples.length > 2 && event.timeStamp - samples[0].time > VELOCITY_WINDOW_MS) samples.shift();
        } else {
            // Pinch: compare the first two pointers before and after this one moved.
            const [a, b] = [...pointers.entries()].slice(0, 2);
            const before = [a[1], b[1]];
            const after = [a[0] === event.pointerId ? { x, y } : a[1], b[0] === event.pointerId ? { x, y } : b[1]];
            const midBefore = midpoint(before[0], before[1]);
            const midAfter = midpoint(after[0], after[1]);
            const distBefore = distance(before[0], before[1]);
            const distAfter = distance(after[0], after[1]);

            handlers.pan(midAfter.x - midBefore.x, midAfter.y - midBefore.y);
            if (distBefore > 0 && distAfter > 0) handlers.zoom(midAfter.x, midAfter.y, distAfter / distBefore);
        }

        pointers.set(event.pointerId, { x, y });
        if (tap && Math.hypot(x - tap.x, y - tap.y) > TAP_SLOP_PX) tap = undefined;
    };

    const onPointerUp = (event: PointerEvent) => {
        if (!pointers.delete(event.pointerId)) return;
        if (pointers.size > 0) {
            // Down to one finger after a pinch: carry on panning from where it is, with no glide.
            samples = [];
            return;
        }

        const [x, y] = local(event);
        if (tap && event.type === 'pointerup' && event.timeStamp - tap.time < TAP_MAX_MS) {
            tap = undefined;
            handlers.tap(x, y);
            return;
        }
        tap = undefined;

        const first = samples[0];
        const last = samples[samples.length - 1];
        const elapsed = last && first ? last.time - first.time : 0;
        // A drag that stopped before the finger lifted shouldn't glide.
        const stale = last ? event.timeStamp - last.time > 50 : true;
        if (elapsed > 0 && !stale) handlers.release(((last.x - first.x) / elapsed) * 1000, ((last.y - first.y) / elapsed) * 1000);
        else handlers.release(0, 0);
        samples = [];
    };

    const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const [x, y] = local(event);
        const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
        // ctrlKey marks a trackpad pinch, which reports much smaller deltas than a wheel notch.
        const sensitivity = event.ctrlKey ? 0.01 : 0.0015;
        handlers.grab();
        handlers.zoom(x, y, Math.exp(-event.deltaY * lines * sensitivity));
    };

    const onLeave = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && !pointers.has(event.pointerId)) handlers.leave();
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('wheel', onWheel, { passive: false });

    return () => {
        element.removeEventListener('pointerdown', onPointerDown);
        element.removeEventListener('pointermove', onPointerMove);
        element.removeEventListener('pointerup', onPointerUp);
        element.removeEventListener('pointercancel', onPointerUp);
        element.removeEventListener('pointerleave', onLeave);
        element.removeEventListener('wheel', onWheel);
    };
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
