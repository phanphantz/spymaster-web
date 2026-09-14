import { bboxOverlaps, visibleBounds, type Camera, type Viewport } from './camera';
import type { MapFeature, TierName } from './mapIndex';
import { MAP_STYLE, hexToRgb } from './mapStyle';
import { MITER_LIMIT, VERTEX_STRIDE, type TierMesh } from './meshBuilder';

/**
 * Draws the world map with WebGL2.
 *
 * Every tier's geometry is uploaded once and never touched again; a frame is only uniforms and a
 * handful of draw calls — a full-screen graticule pass that doubles as the clear, then fills, then
 * borders. Features are laid out in index order, so the frame walks the ~250 feature bounds, keeps
 * the ones on screen, and merges consecutive survivors into single draws. Nothing here runs unless
 * the owner asks for a frame; an idle map costs nothing.
 */
export class MapRenderer {
    private readonly gl: WebGL2RenderingContext;
    private readonly fill: Program;
    private readonly line: Program;
    private readonly graticule: Program;
    private readonly emptyVao: WebGLVertexArrayObject;
    private readonly colours: WebGLTexture;
    private readonly tiers = new Map<TierName, GpuTier>();
    private width = 1;
    private height = 1;
    private pixelRatio = 1;

    static create(canvas: HTMLCanvasElement, features: readonly MapFeature[]): MapRenderer | undefined {
        const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
        return gl ? new MapRenderer(gl, features) : undefined;
    }

    private constructor(
        gl: WebGL2RenderingContext,
        private readonly features: readonly MapFeature[],
    ) {
        this.gl = gl;
        this.fill = new Program(gl, FILL_VS, SOLID_FS);
        this.line = new Program(gl, LINE_VS, SOLID_FS);
        this.graticule = new Program(gl, FULLSCREEN_VS, GRATICULE_FS);
        this.emptyVao = gl.createVertexArray()!;
        this.colours = this.createColourTexture();
    }

    upload(tier: TierName, mesh: TierMesh): void {
        const { gl } = this;
        this.tiers.get(tier)?.dispose(gl);

        const vertices = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);

        const vaoFor = (indices: Uint32Array): [WebGLVertexArrayObject, WebGLBuffer] => {
            const vao = gl.createVertexArray()!;
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.SHORT, false, VERTEX_STRIDE, 0);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 2, gl.BYTE, true, VERTEX_STRIDE, 4);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_SHORT, VERTEX_STRIDE, 6);
            const buffer = gl.createBuffer()!;
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
            gl.bindVertexArray(null);
            return [vao, buffer];
        };

        const [fillVao, fillBuffer] = vaoFor(mesh.fillIndices);
        const [borderVao, borderBuffer] = vaoFor(mesh.borderIndices);

        this.tiers.set(
            tier,
            new GpuTier(mesh.unitDeg, vertices, fillVao, fillBuffer, borderVao, borderBuffer, mesh.fillRanges, mesh.borderRanges),
        );
    }

    /** Sizes the drawing buffer. `pixelRatio` is capped by the caller — past 2× the extra pixels
     *  cost fill rate on phones without anyone seeing the difference. */
    resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
        const canvas = this.gl.canvas as HTMLCanvasElement;
        this.width = Math.max(1, Math.round(cssWidth * pixelRatio));
        this.height = Math.max(1, Math.round(cssHeight * pixelRatio));
        this.pixelRatio = pixelRatio;
        if (canvas.width !== this.width) canvas.width = this.width;
        if (canvas.height !== this.height) canvas.height = this.height;
    }

    draw(camera: Camera, viewport: Viewport, hover: number, selected: number): void {
        const { gl } = this;
        gl.viewport(0, 0, this.width, this.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);

        this.drawGraticule(camera, viewport);

        const tier = this.pickTier(camera.ppd);
        if (!tier) return;

        const unitPx = camera.ppd * tier.unitDeg;
        const scale = [(2 * unitPx) / viewport.width, (2 * unitPx) / viewport.height];
        const centre = [camera.lon / tier.unitDeg, camera.lat / tier.unitDeg];
        const visible = this.visibleFeatures(camera, viewport);

        const fill = this.fill.use();
        gl.uniform2fv(fill.u('u_centre'), centre);
        gl.uniform2fv(fill.u('u_scale'), scale);
        gl.uniform1i(fill.u('u_hover'), hover);
        gl.uniform1i(fill.u('u_selected'), selected);
        gl.uniform4fv(fill.u('u_hoverTint'), [...hexToRgb(MAP_STYLE.hover.colour), MAP_STYLE.hover.mix]);
        gl.uniform4fv(fill.u('u_selectedTint'), [...hexToRgb(MAP_STYLE.selected.colour), MAP_STYLE.selected.mix]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.colours);
        gl.uniform1i(fill.u('u_colours'), 0);
        gl.bindVertexArray(tier.fillVao);
        drawRuns(gl, visible, tier.fillRanges);

        const line = this.line.use();
        gl.uniform2fv(line.u('u_centre'), centre);
        gl.uniform2fv(line.u('u_scale'), scale);
        gl.uniform1f(line.u('u_halfWidth'), (MAP_STYLE.border.widthPx / 2 / unitPx) * MITER_LIMIT);
        gl.uniform4fv(line.u('u_colour'), [...hexToRgb(MAP_STYLE.border.colour), 1]);
        gl.bindVertexArray(tier.borderVao);
        drawRuns(gl, visible, tier.borderRanges);

        if (selected >= 0 && visible.includes(selected)) {
            gl.uniform1f(line.u('u_halfWidth'), (MAP_STYLE.selected.borderWidthPx / 2 / unitPx) * MITER_LIMIT);
            gl.uniform4fv(line.u('u_colour'), [...hexToRgb(MAP_STYLE.selected.borderColour), 1]);
            drawRuns(gl, [selected], tier.borderRanges);
        }

        gl.bindVertexArray(null);
    }

    dispose(): void {
        const { gl } = this;
        for (const tier of this.tiers.values()) tier.dispose(gl);
        this.tiers.clear();
        this.fill.dispose();
        this.line.dispose();
        this.graticule.dispose();
        gl.deleteVertexArray(this.emptyVao);
        gl.deleteTexture(this.colours);
    }

    /**
     * The coarsest tier whose lattice step is under ~1.5px at this zoom — the quantization
     * stair-step stays below what the eye picks out, and nothing finer is drawn than needed.
     * Falls back to the finest tier present while the rest are still arriving.
     */
    private pickTier(ppd: number): GpuTier | undefined {
        const loaded = [...this.tiers.values()].sort((a, b) => b.unitDeg - a.unitDeg);
        return loaded.find((tier) => tier.unitDeg * ppd <= 1.5) ?? loaded[loaded.length - 1];
    }

    private visibleFeatures(camera: Camera, viewport: Viewport): number[] {
        const view = visibleBounds(camera, viewport);
        const visible: number[] = [];
        for (let i = 0; i < this.features.length; i++) if (bboxOverlaps(this.features[i].bbox, view)) visible.push(i);
        return visible;
    }

    private drawGraticule(camera: Camera, viewport: Viewport): void {
        const { gl } = this;
        const { graticule } = MAP_STYLE;
        const degPerPx = 1 / (camera.ppd * this.pixelRatio);
        // gl_FragCoord runs from the bottom-left corner, in device pixels.
        const originLon = camera.lon - viewport.width / 2 / camera.ppd;
        const originLat = camera.lat - viewport.height / 2 / camera.ppd;

        const program = this.graticule.use();
        gl.uniform2f(program.u('u_origin'), originLon, originLat);
        gl.uniform1f(program.u('u_degPerPx'), degPerPx);
        gl.uniform1f(program.u('u_step'), graticule.stepDeg);
        gl.uniform1f(program.u('u_halfWidthPx'), (graticule.widthPx * this.pixelRatio) / 2);
        gl.uniform3fv(program.u('u_ocean'), hexToRgb(MAP_STYLE.ocean));
        gl.uniform4fv(program.u('u_line'), [...hexToRgb(graticule.colour), graticule.alpha]);
        gl.bindVertexArray(this.emptyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    private createColourTexture(): WebGLTexture {
        const { gl } = this;
        const pixels = new Uint8Array(Math.max(1, this.features.length) * 4);
        this.features.forEach((feature, i) => {
            const shade = MAP_STYLE.land[(feature.tint - 1 + MAP_STYLE.land.length) % MAP_STYLE.land.length];
            const [r, g, b] = hexToRgb(shade);
            pixels.set([r * 255, g * 255, b * 255, 255], i * 4);
        });

        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, Math.max(1, this.features.length), 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texture;
    }
}

/** Draws the given features (ascending) from a per-feature `[first, count]` range table, merging
 *  consecutive ranges into one call. */
function drawRuns(gl: WebGL2RenderingContext, features: readonly number[], ranges: Uint32Array): void {
    let start = 0;
    let count = 0;
    for (const feature of features) {
        const first = ranges[feature * 2];
        const length = ranges[feature * 2 + 1];
        if (length === 0) continue;
        if (count > 0 && first === start + count) {
            count += length;
            continue;
        }
        if (count > 0) gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, start * 4);
        start = first;
        count = length;
    }
    if (count > 0) gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, start * 4);
}

class GpuTier {
    constructor(
        readonly unitDeg: number,
        private readonly vertices: WebGLBuffer,
        readonly fillVao: WebGLVertexArrayObject,
        private readonly fillBuffer: WebGLBuffer,
        readonly borderVao: WebGLVertexArrayObject,
        private readonly borderBuffer: WebGLBuffer,
        readonly fillRanges: Uint32Array,
        readonly borderRanges: Uint32Array,
    ) {}

    dispose(gl: WebGL2RenderingContext): void {
        gl.deleteVertexArray(this.fillVao);
        gl.deleteVertexArray(this.borderVao);
        gl.deleteBuffer(this.vertices);
        gl.deleteBuffer(this.fillBuffer);
        gl.deleteBuffer(this.borderBuffer);
    }
}

class Program {
    private readonly program: WebGLProgram;
    private readonly uniforms = new Map<string, WebGLUniformLocation | null>();

    constructor(
        private readonly gl: WebGL2RenderingContext,
        vertexSource: string,
        fragmentSource: string,
    ) {
        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
        gl.bindAttribLocation(program, 0, 'a_pos');
        gl.bindAttribLocation(program, 1, 'a_offset');
        gl.bindAttribLocation(program, 2, 'a_feature');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
            throw new Error(`Map shader link failed: ${gl.getProgramInfoLog(program)}`);
        }
        this.program = program;
    }

    use(): this {
        this.gl.useProgram(this.program);
        return this;
    }

    u(name: string): WebGLUniformLocation | null {
        if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
        return this.uniforms.get(name)!;
    }

    dispose(): void {
        this.gl.deleteProgram(this.program);
    }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Map shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
}

// Positions are lattice integers and the centre is in the same units, so the subtraction happens
// before any scaling — float32 keeps full precision at every zoom.
const FILL_VS = `#version 300 es
in vec2 a_pos;
in uint a_feature;
uniform vec2 u_centre;
uniform vec2 u_scale;
uniform sampler2D u_colours;
uniform int u_hover;
uniform int u_selected;
uniform vec4 u_hoverTint;
uniform vec4 u_selectedTint;
flat out vec4 v_colour;
void main() {
    gl_Position = vec4((a_pos - u_centre) * u_scale, 0.0, 1.0);
    int feature = int(a_feature);
    vec3 colour = texelFetch(u_colours, ivec2(feature, 0), 0).rgb;
    if (feature == u_selected) colour = mix(colour, u_selectedTint.rgb, u_selectedTint.a);
    else if (feature == u_hover) colour = mix(colour, u_hoverTint.rgb, u_hoverTint.a);
    v_colour = vec4(colour, 1.0);
}`;

const LINE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_offset;
uniform vec2 u_centre;
uniform vec2 u_scale;
uniform float u_halfWidth;
uniform vec4 u_colour;
flat out vec4 v_colour;
void main() {
    gl_Position = vec4((a_pos + a_offset * u_halfWidth - u_centre) * u_scale, 0.0, 1.0);
    v_colour = u_colour;
}`;

const SOLID_FS = `#version 300 es
precision mediump float;
flat in vec4 v_colour;
out vec4 o_colour;
void main() {
    o_colour = v_colour;
}`;

const FULLSCREEN_VS = `#version 300 es
void main() {
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const GRATICULE_FS = `#version 300 es
precision highp float;
uniform vec2 u_origin;
uniform float u_degPerPx;
uniform float u_step;
uniform float u_halfWidthPx;
uniform vec3 u_ocean;
uniform vec4 u_line;
out vec4 o_colour;
void main() {
    vec2 deg = u_origin + gl_FragCoord.xy * u_degPerPx;
    // Pixel distance to the nearest grid line on each axis.
    vec2 toLine = abs(fract(deg / u_step + 0.5) - 0.5) * u_step / u_degPerPx;
    float coverage = clamp(u_halfWidthPx + 0.5 - min(toLine.x, toLine.y), 0.0, 1.0);
    o_colour = vec4(mix(u_ocean, u_line.rgb, coverage * u_line.a), 1.0);
}`;
