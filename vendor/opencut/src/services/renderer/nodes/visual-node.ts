import { BaseNode } from "./base-node";
import type { Effect, EffectPass } from "@opencut/effects/types";
import type { Mask } from "@opencut/masks/types";
import type { BlendMode, Transform } from "@opencut/rendering";
import type { RetimeConfig, VisualElement } from "@opencut/timeline";
import type { ColorAdjust } from "@opencut/look/adjust";
import type { ClipTransitions, TransitionFinish } from "@opencut/look/transitions";

export interface VisualNodeParams {
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	transform: Transform;
	animations?: VisualElement["animations"];
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
	/** Misty: the clip's color adjustments and transitions (look/). */
	adjust?: ColorAdjust;
	transitions?: ClipTransitions;
}

export interface ResolvedVisualNodeState {
	localTime: number;
	transform: Transform;
	opacity: number;
	effectPasses: EffectPass[][];
	/** Misty: the color adjustments at this moment, when the clip has any. */
	adjust?: ColorAdjust;
	/** Misty: a dip or a wipe under way at this moment (look/transitions.ts). */
	finish?: TransitionFinish;
}

export interface ResolvedVisualSourceNodeState extends ResolvedVisualNodeState {
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
	Resolved extends ResolvedVisualNodeState = ResolvedVisualNodeState,
> extends BaseNode<Params, Resolved> {}
