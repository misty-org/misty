// Misty: transitions into and out of a clip, the Transitions tab OpenCut left empty. A clip
// fades, slides, zooms, comes into focus, dips from black or white or is wiped on over its first
// moments and leaves the same way over its last. They are element params, applied where the
// renderer works out a clip's state at a moment (services/renderer/resolve.ts), so the preview
// and the export show the same thing. Moving, fading and blurring go through the clip's
// transform, opacity and effect passes; a dip and a wipe change the clip's own pixels, so they
// are a "finish" drawn into its frame before the compositor gets it (drawTransitionFinish).
import { TICKS_PER_SECOND } from "@opencut/wasm";
import type { ParamValues } from "@opencut/params";
import type { ElementParamDefinition } from "@opencut/params/registry";
import type { Transform } from "@opencut/rendering";

export const TRANSITION_KINDS = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Fade" },
	{ value: "slide-left", label: "Slide from left" },
	{ value: "slide-right", label: "Slide from right" },
	{ value: "slide-up", label: "Slide from below" },
	{ value: "slide-down", label: "Slide from above" },
	{ value: "zoom", label: "Zoom" },
	{ value: "blur", label: "Focus" },
	{ value: "dip-black", label: "Dip to black" },
	{ value: "dip-white", label: "Dip to white" },
	{ value: "wipe-left", label: "Wipe from left" },
	{ value: "wipe-right", label: "Wipe from right" },
] as const;

export type TransitionKind = (typeof TRANSITION_KINDS)[number]["value"];

export const TRANSITION_KEYS = [
	"transition.in",
	"transition.inDuration",
	"transition.out",
	"transition.outDuration",
] as const;

export const DEFAULT_TRANSITION_SECONDS = 0.5;

export const TRANSITION_PARAMS: ElementParamDefinition[] = [
	{
		key: "transition.in",
		label: "Transition in",
		type: "select",
		default: "none",
		keyframable: false,
		options: TRANSITION_KINDS.map(({ value, label }) => ({ value, label })),
	},
	{
		key: "transition.inDuration",
		label: "In length",
		type: "number",
		default: DEFAULT_TRANSITION_SECONDS,
		min: 0.05,
		max: 5,
		step: 0.05,
		keyframable: false,
		dependencies: [],
	},
	{
		key: "transition.out",
		label: "Transition out",
		type: "select",
		default: "none",
		keyframable: false,
		options: TRANSITION_KINDS.map(({ value, label }) => ({ value, label })),
	},
	{
		key: "transition.outDuration",
		label: "Out length",
		type: "number",
		default: DEFAULT_TRANSITION_SECONDS,
		min: 0.05,
		max: 5,
		step: 0.05,
		keyframable: false,
		dependencies: [],
	},
];

export type ClipTransitions = {
	in: { kind: TransitionKind; seconds: number };
	out: { kind: TransitionKind; seconds: number };
};

const kinds = new Set<string>(TRANSITION_KINDS.map((kind) => kind.value));

function readKind(params: ParamValues, key: string): TransitionKind {
	const value = params[key];
	return typeof value === "string" && kinds.has(value) ? (value as TransitionKind) : "none";
}

function readSeconds(params: ParamValues, key: string): number {
	const value = params[key];
	return typeof value === "number" && value > 0 ? value : DEFAULT_TRANSITION_SECONDS;
}

export function readTransitions(params: ParamValues): ClipTransitions | undefined {
	const transitions: ClipTransitions = {
		in: { kind: readKind(params, "transition.in"), seconds: readSeconds(params, "transition.inDuration") },
		out: {
			kind: readKind(params, "transition.out"),
			seconds: readSeconds(params, "transition.outDuration"),
		},
	};
	return transitions.in.kind === "none" && transitions.out.kind === "none" ? undefined : transitions;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** How far through one transition a clip is: 0 at its hidden end, 1 once fully on screen. */
function progress(elapsedTicks: number, seconds: number): number {
	const length = seconds * TICKS_PER_SECOND;
	return length <= 0 ? 1 : smooth(Math.min(1, Math.max(0, elapsedTicks / length)));
}

/**
 * What a dip or a wipe does to a clip's pixels at one moment: a dip mixes its picture toward
 * black or white by `amount` (0–1), keeping its transparency; a wipe shows only the part of
 * it between `left` and `right`, as shares (0–1) of its width.
 */
export type TransitionFinish = {
	dip: { color: "black" | "white"; amount: number } | null;
	wipe: { left: number; right: number } | null;
};

export type TransitionedState = {
	transform: Transform;
	opacity: number;
	/** Blur intensity on OpenCut's 0–100 scale, for the focus transition; 0 for none. */
	blur: number;
	/** A dip or a wipe under way, or null when neither is. */
	finish: TransitionFinish | null;
};

/**
 * A clip's transform, opacity and blur at a moment, with its transitions applied. Both can run
 * at once on a short clip; each is measured from its own end of the clip.
 */
export function applyTransitions({
	transitions,
	localTicks,
	durationTicks,
	transform,
	opacity,
	canvas,
}: {
	transitions: ClipTransitions | undefined;
	localTicks: number;
	durationTicks: number;
	transform: Transform;
	opacity: number;
	canvas: { width: number; height: number };
}): TransitionedState {
	let state: TransitionedState = { transform, opacity, blur: 0, finish: null };
	if (!transitions) return state;
	const phases: Array<[TransitionKind, number, "in" | "out"]> = [
		[transitions.in.kind, progress(localTicks, transitions.in.seconds), "in"],
		[transitions.out.kind, progress(durationTicks - localTicks, transitions.out.seconds), "out"],
	];
	for (const [kind, shown, side] of phases) {
		if (kind === "none" || shown >= 1) continue;
		state = applyOne(kind, shown, state, canvas, side);
	}
	return state;
}

/**
 * The part of a clip a wipe shows. A wipe from the left moves its edge rightwards: coming in,
 * the clip is uncovered from its left side; going out, it is covered from its left side.
 */
function wipeShown(
	kind: "wipe-left" | "wipe-right",
	shown: number,
	side: "in" | "out",
): { left: number; right: number } {
	const fromLeft = kind === "wipe-left";
	return fromLeft === (side === "in")
		? { left: 0, right: shown }
		: { left: 1 - shown, right: 1 };
}

function withFinish(state: TransitionedState, change: Partial<TransitionFinish>): TransitionedState {
	const finish = state.finish ?? { dip: null, wipe: null };
	return { ...state, finish: { ...finish, ...change } };
}

function applyOne(
	kind: TransitionKind,
	shown: number,
	state: TransitionedState,
	canvas: { width: number; height: number },
	side: "in" | "out",
): TransitionedState {
	const away = 1 - shown;
	const { transform } = state;
	const moved = (dx: number, dy: number): TransitionedState => ({
		...state,
		transform: {
			...transform,
			position: { x: transform.position.x + dx, y: transform.position.y + dy },
		},
	});
	switch (kind) {
		case "fade":
			return { ...state, opacity: state.opacity * shown };
		case "slide-left":
			return moved(-canvas.width * away, 0);
		case "slide-right":
			return moved(canvas.width * away, 0);
		case "slide-up":
			return moved(0, canvas.height * away);
		case "slide-down":
			return moved(0, -canvas.height * away);
		case "zoom": {
			const scale = 0.6 + 0.4 * shown;
			return {
				...state,
				opacity: state.opacity * shown,
				transform: { ...transform, scaleX: transform.scaleX * scale, scaleY: transform.scaleY * scale },
			};
		}
		case "blur":
			return { ...state, opacity: state.opacity * (0.4 + 0.6 * shown), blur: Math.max(state.blur, 40 * away) };
		case "dip-black":
		case "dip-white": {
			const color = kind === "dip-black" ? "black" : "white";
			const current = state.finish?.dip;
			// Both ends dipping at once on a short clip: the deeper dip shows.
			if (current && current.amount >= away) return state;
			return withFinish(state, { dip: { color, amount: away } });
		}
		case "wipe-left":
		case "wipe-right": {
			const next = wipeShown(kind, shown, side);
			const current = state.finish?.wipe;
			// Both ends wiping at once: only what both show is shown.
			const wipe = current
				? { left: Math.max(current.left, next.left), right: Math.min(current.right, next.right) }
				: next;
			return withFinish(state, { wipe });
		}
		default:
			return state;
	}
}

/** A finish's cache key: the same finish draws the same pixels. */
export function transitionFinishKey(finish: TransitionFinish | null | undefined): string | undefined {
	if (!finish) return undefined;
	const dip = finish.dip ? `${finish.dip.color}:${finish.dip.amount.toFixed(4)}` : "-";
	const wipe = finish.wipe ? `${finish.wipe.left.toFixed(4)}:${finish.wipe.right.toFixed(4)}` : "-";
	return `${dip}|${wipe}`;
}

/** The same finish for a clip drawn mirrored, so a wipe still moves the way it says on screen. */
export function mirrorTransitionFinish(finish: TransitionFinish): TransitionFinish {
	return finish.wipe
		? { ...finish, wipe: { left: 1 - finish.wipe.right, right: 1 - finish.wipe.left } }
		: finish;
}

/**
 * Draws a finish over a clip's frame already drawn on `ctx` (`width` × `height`): the dip's
 * color over its pixels, then everything outside the wipe's part cleared.
 */
export function drawTransitionFinish({
	ctx,
	width,
	height,
	finish,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	finish: TransitionFinish;
}): void {
	if (finish.dip && finish.dip.amount > 0) {
		ctx.save();
		ctx.globalCompositeOperation = "source-atop";
		ctx.globalAlpha = Math.min(1, finish.dip.amount);
		ctx.fillStyle = finish.dip.color === "black" ? "#000000" : "#ffffff";
		ctx.fillRect(0, 0, width, height);
		ctx.restore();
	}
	if (finish.wipe) {
		const left = Math.round(Math.min(1, Math.max(0, finish.wipe.left)) * width);
		const right = Math.round(Math.min(1, Math.max(0, finish.wipe.right)) * width);
		if (right <= left) {
			ctx.clearRect(0, 0, width, height);
			return;
		}
		if (left > 0) ctx.clearRect(0, 0, left, height);
		if (right < width) ctx.clearRect(right, 0, width - right, height);
	}
}
