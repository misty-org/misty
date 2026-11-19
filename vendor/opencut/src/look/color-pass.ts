// Misty: applies a clip's color adjustments (adjust.ts) to one frame on the GPU, with WebGL2,
// before the frame goes to OpenCut's compositor. Its Rust core ships no color shader, and the
// canvas `filter` property isn't available in every webview Misty runs in (WebKit's), so this
// draws the frame through one small fragment shader instead. The result is a 2D canvas the
// compositor can upload like any frame.
import type { ColorAdjust } from "./adjust";

const VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_frame;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_warmth;
uniform float u_tint;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 texel = texture(u_frame, v_uv);
  vec3 c = texel.rgb;
  c *= exp2(u_exposure);
  float l = luma(c);
  c += u_shadows * 0.5 * (1.0 - smoothstep(0.0, 0.5, l));
  c += u_highlights * 0.5 * smoothstep(0.5, 1.0, l);
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c += vec3(u_warmth * 0.08, -u_tint * 0.06, -u_warmth * 0.08);
  l = luma(c);
  float chroma = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float vibrance = u_vibrance * (1.0 - clamp(chroma, 0.0, 1.0));
  c = mix(vec3(l), c, 1.0 + u_saturation + vibrance);
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`;

type Pass = {
	canvas: OffscreenCanvas;
	gl: WebGL2RenderingContext;
	program: WebGLProgram;
	texture: WebGLTexture;
	uniforms: Record<keyof ColorAdjust, WebGLUniformLocation | null>;
};

let pass: Pass | null | undefined;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("WebGL could not create a shader.");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
		throw new Error(gl.getShaderInfoLog(shader) ?? "A color shader did not compile.");
	return shader;
}

function createPass(): Pass | null {
	if (typeof OffscreenCanvas === "undefined") return null;
	const canvas = new OffscreenCanvas(1, 1);
	const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
	if (!gl) return null;
	const program = gl.createProgram();
	if (!program) return null;
	gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
	gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
	gl.useProgram(program);
	const buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	const position = gl.getAttribLocation(program, "a_position");
	gl.enableVertexAttribArray(position);
	gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
	const texture = gl.createTexture();
	if (!texture) return null;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	const at = (name: string) => gl.getUniformLocation(program, name);
	return {
		canvas,
		gl,
		program,
		texture,
		uniforms: {
			exposure: at("u_exposure"),
			contrast: at("u_contrast"),
			highlights: at("u_highlights"),
			shadows: at("u_shadows"),
			saturation: at("u_saturation"),
			vibrance: at("u_vibrance"),
			warmth: at("u_warmth"),
			tint: at("u_tint"),
		},
	};
}

/** Whether color adjustments can be drawn here (WebGL2 is available). */
export function canAdjustColor(): boolean {
	if (pass === undefined) pass = createPass();
	return pass !== null;
}

/**
 * Draws `source` with `adjust` applied into `into` (made at the frame's size when not given)
 * and returns it. Without WebGL2 the frame is drawn unchanged.
 */
export function adjustFrame({
	source,
	width,
	height,
	adjust,
	into,
}: {
	source: TexImageSource;
	width: number;
	height: number;
	adjust: ColorAdjust;
	into?: OffscreenCanvas;
}): OffscreenCanvas {
	const target = into && into.width === width && into.height === height ? into : new OffscreenCanvas(width, height);
	const ctx = target.getContext("2d");
	if (!ctx) throw new Error("Could not draw an adjusted frame.");
	if (!canAdjustColor() || !pass) {
		ctx.clearRect(0, 0, width, height);
		ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
		return target;
	}
	const { gl, canvas, texture, uniforms } = pass;
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	gl.viewport(0, 0, width, height);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	for (const [name, location] of Object.entries(uniforms))
		gl.uniform1f(location, adjust[name as keyof ColorAdjust]);
	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	ctx.clearRect(0, 0, width, height);
	ctx.drawImage(canvas, 0, 0);
	return target;
}
