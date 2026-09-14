import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MapFeature } from '../../map/mapIndex';
import { WorldMap, occluderInsets } from '../../map/worldMap';

export interface MapPin {
    id: string;
    lon: number;
    lat: number;
    title: string;
}

interface WorldMapViewProps {
    pins: readonly MapPin[];
    /** A pin to call out — the mission row under the pointer in the contracts panel. */
    highlightedPinId?: string;
    onPinClick: (id: string) => void;
    onPinHover?: (id: string | undefined) => void;
}

let activeMap: WorldMap | undefined;

/** The mounted map, for UI elsewhere that wants to fly it somewhere (a contract row, say). */
export function activeWorldMap(): WorldMap | undefined {
    return activeMap;
}

/** Pins sharing a spot fan out on a small ring so each stays clickable. */
const PIN_FAN_RADIUS_PX = 14;

/**
 * The world map as the game's backdrop: the WebGL canvas, plus DOM overlays for mission pins, the
 * country under the mouse, and the selected country.
 *
 * Memoised, and fed stable props — the screen around it re-renders on every clock tick, and none of
 * that may reach the canvas. Overlays follow the camera by writing transforms straight from the map's
 * frame callback rather than through React state.
 */
export const WorldMapView = memo(function WorldMapView({
    pins,
    highlightedPinId,
    onPinClick,
    onPinHover,
}: WorldMapViewProps): ReactNode {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<WorldMap>();
    const pinElements = useRef(new Map<string, HTMLElement>());
    const [selected, setSelected] = useState<MapFeature>();

    const offsets = useMemo(() => fanOffsets(pins), [pins]);
    const placement = useRef({ pins, offsets });
    placement.current = { pins, offsets };

    useEffect(() => {
        const map: WorldMap = new WorldMap(canvasRef.current!, {
            baseUrl: import.meta.env.BASE_URL,
            insets: () => occluderInsets(map.viewport),
        });
        mapRef.current = map;
        activeMap = map;

        const unsubscribe = [
            map.on('frame', () => placePins(map, placement.current, pinElements.current)),
            map.on('hover', (feature, x, y) => {
                const tooltip = tooltipRef.current;
                if (!tooltip) return;
                const name = map.features[feature]?.name;
                tooltip.hidden = !name;
                if (!name) return;
                if (tooltip.textContent !== name) tooltip.textContent = name;
                tooltip.style.transform = `translate3d(${x + 14}px, ${y + 18}px, 0)`;
            }),
            map.on('select', (feature) => setSelected(map.features[feature])),
        ];

        return () => {
            unsubscribe.forEach((off) => off());
            map.dispose();
            if (activeMap === map) activeMap = undefined;
            mapRef.current = undefined;
        };
    }, []);

    // New or departed pins are placed before paint — the map only re-projects when its camera moves.
    useLayoutEffect(() => {
        if (mapRef.current) placePins(mapRef.current, placement.current, pinElements.current);
    }, [pins, offsets]);

    return (
        <div className="world-map">
            <canvas ref={canvasRef} className="world-map__canvas" aria-label="World map" />

            <div className="world-map__pins">
                {pins.map((pin) => (
                    <button
                        key={pin.id}
                        type="button"
                        className={pin.id === highlightedPinId ? 'map-pin map-pin--active' : 'map-pin'}
                        ref={(element) => {
                            if (element) pinElements.current.set(pin.id, element);
                            else pinElements.current.delete(pin.id);
                        }}
                        onClick={() => onPinClick(pin.id)}
                        onPointerEnter={() => onPinHover?.(pin.id)}
                        onPointerLeave={() => onPinHover?.(undefined)}
                        aria-label={pin.title}
                    >
                        <span className="map-pin__mark" aria-hidden="true" />
                        <span className="map-pin__label">{pin.title}</span>
                    </button>
                ))}
            </div>

            <div ref={tooltipRef} className="map-tooltip" hidden />

            {selected ? (
                <div className="map-selection">
                    <span className="micro">Country</span>
                    <span className="map-selection__name">{selected.name}</span>
                    <button
                        type="button"
                        className="map-selection__clear"
                        onClick={() => mapRef.current?.select(-1)}
                        aria-label="Clear country selection"
                    >
                        ×
                    </button>
                </div>
            ) : null}
        </div>
    );
});

function placePins(
    map: WorldMap,
    { pins, offsets }: { pins: readonly MapPin[]; offsets: Map<string, [number, number]> },
    elements: Map<string, HTMLElement>,
): void {
    for (const pin of pins) {
        const element = elements.get(pin.id);
        if (!element) continue;
        const [x, y] = map.project(pin.lon, pin.lat);
        const [dx, dy] = offsets.get(pin.id) ?? [0, 0];
        element.style.transform = `translate3d(${x + dx}px, ${y + dy}px, 0)`;
    }
}

function fanOffsets(pins: readonly MapPin[]): Map<string, [number, number]> {
    const groups = new Map<string, MapPin[]>();
    for (const pin of pins) {
        const key = `${pin.lon.toFixed(3)},${pin.lat.toFixed(3)}`;
        const group = groups.get(key);
        if (group) group.push(pin);
        else groups.set(key, [pin]);
    }

    const offsets = new Map<string, [number, number]>();
    for (const group of groups.values()) {
        group.forEach((pin, i) => {
            if (group.length === 1) {
                offsets.set(pin.id, [0, 0]);
                return;
            }
            const angle = (i / group.length) * Math.PI * 2 - Math.PI / 2;
            offsets.set(pin.id, [Math.cos(angle) * PIN_FAN_RADIUS_PX, Math.sin(angle) * PIN_FAN_RADIUS_PX]);
        });
    }
    return offsets;
}
