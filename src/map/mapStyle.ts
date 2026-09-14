/**
 * The map's look, drawn from the app's own palette (src/ui/tokens.css) rather than adding hues:
 * the ocean is the page ground, land sits between the ground and the panel surfaces, and cyan is
 * reserved for what the player has picked.
 */
export const MAP_STYLE = {
    /** `--bg`, so the ocean and the page around it are one surface. */
    ocean: '#070b0d',
    /** Lat/lon grid over the ocean — `--cyan` at a whisper. */
    graticule: { colour: '#AFFFF8', alpha: 0.05, stepDeg: 10, widthPx: 1 },
    /** Seven land shades, indexed by Natural Earth's MAPCOLOR7 so neighbours never match. Kept
     *  within a few percent of each other: enough to read a border as two countries, not enough to
     *  make a political map. */
    land: ['#111a1e', '#131c21', '#121d20', '#141e22', '#111b1f', '#131b1f', '#121c22'],
    /** Opaque on purpose: internal borders are drawn once by each neighbour, and an alpha colour
     *  would draw them twice as bright as coastlines. */
    border: { colour: '#2b3a40', widthPx: 1 },
    hover: { colour: '#A6B7BF', mix: 0.08 },
    selected: { colour: '#AFFFF8', mix: 0.1, borderColour: '#AFFFF8', borderWidthPx: 2 },
} as const;

export function hexToRgb(hex: string): [number, number, number] {
    const value = parseInt(hex.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
