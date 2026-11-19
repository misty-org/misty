import type { ParamDefinition, ParamValues } from "@opencut/params";

export const DEFAULT_GRAPHIC_SOURCE_SIZE = 512;

export interface GraphicRenderContext {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	params: ParamValues;
	width: number;
	height: number;
	/** Misty: for an animated graphic, the moment drawn and the element's length, in seconds. */
	time?: number;
	duration?: number;
}

export interface GraphicDefinition {
	id: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	/**
	 * Misty: an animated graphic (a motion graphic) is drawn at the canvas's own size for each
	 * moment, rather than once on a square, and is left out of the shapes on the Stickers tab.
	 */
	animated?: boolean;
	/** Misty: what has to load before the graphic's first frame is drawn. */
	prepare?: () => Promise<void>;
	render(context: GraphicRenderContext): void;
}

export interface GraphicInstance {
	definitionId: string;
	params: ParamValues;
}
