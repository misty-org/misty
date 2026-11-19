import {
	getCompositorCanvas,
	getLastFrameProfile,
	initCompositor,
	releaseTexture,
	renderFrame,
	resizeCompositor,
	uploadTexture,
} from "opencut-wasm";
import {
	incrementCounter,
	isRenderPerfEnabled,
	recordWasmFrameProfile,
} from "@opencut/diagnostics/render-perf";
import type {
	ExternalTextureDescriptor,
	FrameDescriptor,
	RenderedTextureDescriptor,
	TextureUploadDescriptor,
} from "./types";
import { adjustFrame } from "@opencut/look/color-pass";
import { adjustKey } from "@opencut/look/adjust";
import {
	drawTransitionFinish,
	transitionFinishKey,
	type TransitionFinish,
} from "@opencut/look/transitions";

/**
 * One slot in the derived-texture cache. The OffscreenCanvas is persistent —
 * we reuse and redraw into it across frames, which is the change that takes
 * the WebGL upload path off the per-frame critical path for static content.
 */
type RenderedCacheEntry = {
	kind: "rendered";
	canvas: OffscreenCanvas;
	contentHash: string;
	width: number;
	height: number;
};

type ExternalCacheEntry = {
	kind: "external";
	source: CanvasImageSource;
	width: number;
	height: number;
	/** Misty: the adjustments drawn into the uploaded frame, and the canvas they were drawn on. */
	adjustKey?: string;
	adjusted?: OffscreenCanvas;
	/** Misty: the dip or wipe drawn into it, and the canvas it was drawn on without adjustments. */
	finishKey?: string;
	finished?: OffscreenCanvas;
};

/** Misty: a frame with a transition's dip or wipe drawn into it, on a canvas of its own. */
function finishFrame({
	source,
	width,
	height,
	finish,
	into,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	finish: TransitionFinish;
	into?: OffscreenCanvas;
}): OffscreenCanvas {
	const target =
		into && into.width === width && into.height === height
			? into
			: new OffscreenCanvas(width, height);
	const ctx = target.getContext("2d");
	if (!ctx) throw new Error("Could not draw a transition into a frame.");
	if (target !== source) {
		ctx.clearRect(0, 0, width, height);
		ctx.drawImage(source, 0, 0, width, height);
	}
	drawTransitionFinish({ ctx, width, height, finish });
	return target;
}

class WasmCompositor {
	private canvas: HTMLCanvasElement | null = null;
	private initializedSize: { width: number; height: number } | null = null;
	private cache = new Map<string, RenderedCacheEntry | ExternalCacheEntry>();

	ensureInitialized({ width, height }: { width: number; height: number }) {
		if (!this.canvas) {
			initCompositor(width, height);
			this.canvas = getCompositorCanvas();
			this.initializedSize = { width, height };
			return;
		}

		if (
			!this.initializedSize ||
			this.initializedSize.width !== width ||
			this.initializedSize.height !== height
		) {
			resizeCompositor(width, height);
			this.initializedSize = { width, height };
		}
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.canvas) {
			throw new Error("Compositor is not initialized");
		}
		return this.canvas;
	}

	syncTextures(textures: TextureUploadDescriptor[]) {
		const nextIds = new Set(textures.map((texture) => texture.id));
		for (const previousId of this.cache.keys()) {
			if (!nextIds.has(previousId)) {
				releaseTexture(previousId);
				this.cache.delete(previousId);
			}
		}

		for (const texture of textures) {
			if (texture.kind === "external") {
				this.syncExternalTexture(texture);
			} else {
				this.syncRenderedTexture(texture);
			}
		}
	}

	render(frame: FrameDescriptor) {
		renderFrame(frame);
		if (isRenderPerfEnabled()) {
			recordWasmFrameProfile(
				getLastFrameProfile() as Array<{ name: string; durationMs: number }>,
			);
		}
	}

	private syncExternalTexture(texture: ExternalTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		const wantedAdjustKey = texture.adjust ? adjustKey(texture.adjust) : undefined;
		const wantedFinishKey = transitionFinishKey(texture.finish);
		if (
			previous?.kind === "external" &&
			previous.source === texture.source &&
			previous.width === texture.width &&
			previous.height === texture.height &&
			previous.adjustKey === wantedAdjustKey &&
			previous.finishKey === wantedFinishKey
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		incrementCounter({ name: "textureUpload" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});
		// Misty: a clip with color adjustments uploads its frame drawn through them.
		const adjusted = texture.adjust
			? adjustFrame({
					source: texture.source as TexImageSource,
					width: texture.width,
					height: texture.height,
					adjust: texture.adjust,
					into: previous?.kind === "external" ? previous.adjusted : undefined,
				})
			: undefined;
		// Misty: a dip or a wipe is drawn over the frame, adjusted or not.
		const finished = texture.finish
			? finishFrame({
					source: adjusted ?? texture.source,
					width: texture.width,
					height: texture.height,
					finish: texture.finish,
					into:
						adjusted ??
						(previous?.kind === "external" ? previous.finished : undefined),
				})
			: undefined;
		uploadTexture({
			id: texture.id,
			source:
				finished ??
				adjusted ??
				ensureOffscreenCanvas({
					source: texture.source,
					width: texture.width,
					height: texture.height,
					label: `texture upload ${texture.id}`,
				}),
			width: texture.width,
			height: texture.height,
		});
		this.cache.set(texture.id, {
			kind: "external",
			source: texture.source,
			width: texture.width,
			height: texture.height,
			adjustKey: wantedAdjustKey,
			adjusted,
			finishKey: wantedFinishKey,
			finished: finished && finished !== adjusted ? finished : undefined,
		});
	}

	private syncRenderedTexture(texture: RenderedTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		if (
			previous?.kind === "rendered" &&
			previous.contentHash === texture.contentHash &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		const canvas =
			previous?.kind === "rendered" &&
			previous.width === texture.width &&
			previous.height === texture.height
				? previous.canvas
				: createBackingCanvas({
						width: texture.width,
						height: texture.height,
					});

		const ctx = canvas.getContext("2d");
		if (!ctx) {
			throw new Error(`Failed to get 2d context for texture ${texture.id}`);
		}
		ctx.clearRect(0, 0, texture.width, texture.height);
		texture.draw(ctx);

		incrementCounter({ name: "textureUpload" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});
		uploadTexture({
			id: texture.id,
			source: canvas,
			width: texture.width,
			height: texture.height,
		});
		this.cache.set(texture.id, {
			kind: "rendered",
			canvas,
			contentHash: texture.contentHash,
			width: texture.width,
			height: texture.height,
		});
	}
}

export const wasmCompositor = new WasmCompositor();

function createBackingCanvas({
	width,
	height,
}: {
	width: number;
	height: number;
}): OffscreenCanvas {
	if (typeof OffscreenCanvas === "undefined") {
		throw new Error("OffscreenCanvas is not supported in this environment");
	}
	return new OffscreenCanvas(width, height);
}

function ensureOffscreenCanvas({
	source,
	width,
	height,
	label,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	label: string;
}): OffscreenCanvas {
	if (source instanceof OffscreenCanvas) {
		return source;
	}

	if (typeof OffscreenCanvas === "undefined") {
		throw new Error(`OffscreenCanvas is required for ${label}`);
	}

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error(`Failed to get 2d context for ${label}`);
	}
	context.clearRect(0, 0, width, height);
	context.drawImage(source, 0, 0, width, height);
	return canvas;
}
