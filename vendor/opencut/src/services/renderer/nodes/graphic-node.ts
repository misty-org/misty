import { createCanvasSurface } from "../canvas-utils";
import {
	DEFAULT_GRAPHIC_SOURCE_SIZE,
	getGraphicDefinition,
	prepareGraphic,
	registerDefaultGraphics,
} from "@opencut/graphics";
import type { ParamValues } from "@opencut/params";
import { TICKS_PER_SECOND } from "@opencut/wasm";
import {
	VisualNode,
	type ResolvedVisualNodeState,
	type VisualNodeParams,
} from "./visual-node";

export interface GraphicNodeParams extends VisualNodeParams {
	definitionId: string;
	params: ParamValues;
}

export interface ResolvedGraphicNodeState extends ResolvedVisualNodeState {
	resolvedParams: ParamValues;
	/** Misty: the size the graphic is drawn at (getGraphicSourceSize). */
	sourceWidth: number;
	sourceHeight: number;
}

export class GraphicNode extends VisualNode<
	GraphicNodeParams,
	ResolvedGraphicNodeState
> {
	private cachedKey: string | null = null;
	private cachedSource: OffscreenCanvas | null = null;
	// Misty: an animated graphic redraws as time moves, on two canvases in turn, so the
	// compositor, which keeps a texture while its source stays the same object, sees each change.
	private spareSurface: {
		canvas: OffscreenCanvas;
		context: OffscreenCanvasRenderingContext2D;
	} | null = null;
	private cachedContext: OffscreenCanvasRenderingContext2D | null = null;

	constructor(params: GraphicNodeParams) {
		super(params);
		registerDefaultGraphics();
	}

	/** Misty: loads what the graphic needs before its first frame (resolve.ts awaits it). */
	prepare(): Promise<void> {
		return prepareGraphic({ definitionId: this.params.definitionId });
	}

	getSource({
		resolvedParams,
		localTime = 0,
		sourceWidth = DEFAULT_GRAPHIC_SOURCE_SIZE,
		sourceHeight = DEFAULT_GRAPHIC_SOURCE_SIZE,
	}: {
		resolvedParams: ParamValues;
		localTime?: number;
		sourceWidth?: number;
		sourceHeight?: number;
	}): OffscreenCanvas {
		const definition = getGraphicDefinition({
			definitionId: this.params.definitionId,
		});
		const time = definition.animated ? localTime / TICKS_PER_SECOND : undefined;
		const cacheKey = JSON.stringify({
			definitionId: this.params.definitionId,
			params: resolvedParams,
			time,
			sourceWidth,
			sourceHeight,
		});
		if (this.cachedSource && this.cachedKey === cacheKey) {
			return this.cachedSource;
		}

		const surface = definition.animated
			? this.takeAnimatedSurface({ width: sourceWidth, height: sourceHeight })
			: createCanvasSurface({ width: sourceWidth, height: sourceHeight });
		const { canvas, context } = surface;

		definition.render({
			ctx: context,
			params: resolvedParams,
			width: sourceWidth,
			height: sourceHeight,
			time,
			duration: definition.animated
				? this.params.duration / TICKS_PER_SECOND
				: undefined,
		});

		if (definition.animated && this.cachedSource && this.cachedContext) {
			this.spareSurface = {
				canvas: this.cachedSource,
				context: this.cachedContext,
			};
		}
		this.cachedKey = cacheKey;
		this.cachedSource = canvas;
		this.cachedContext = context;
		return canvas;
	}

	/** Misty: the canvas not shown last, at this size, cleared. */
	private takeAnimatedSurface({
		width,
		height,
	}: {
		width: number;
		height: number;
	}): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
		const spare = this.spareSurface;
		this.spareSurface = null;
		if (spare && spare.canvas.width === width && spare.canvas.height === height) {
			spare.context.setTransform(1, 0, 0, 1, 0, 0);
			spare.context.clearRect(0, 0, width, height);
			return spare;
		}
		return createCanvasSurface({ width, height });
	}
}
