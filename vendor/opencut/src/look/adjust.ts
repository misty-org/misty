// Misty: color adjustments for video and image clips, the Adjustment tab OpenCut left empty.
// They are ordinary element params (so the properties panel, undo, saving and keyframes all
// work), applied to each frame on the GPU by color-pass.ts as it goes to the compositor.
import type { ElementAnimations } from "@opencut/animation/types";
import { resolveNumberAtTime } from "@opencut/animation/values";
import type { ParamValues } from "@opencut/params";
import type { ElementParamDefinition } from "@opencut/params/registry";

export const ADJUST_KEYS = [
	"adjust.exposure",
	"adjust.contrast",
	"adjust.highlights",
	"adjust.shadows",
	"adjust.saturation",
	"adjust.vibrance",
	"adjust.warmth",
	"adjust.tint",
] as const;

export type AdjustKey = (typeof ADJUST_KEYS)[number];

/** Each adjustment at rest is 0; exposure is in stops, the rest run from -1 to 1. */
export type ColorAdjust = Record<
	"exposure" | "contrast" | "highlights" | "shadows" | "saturation" | "vibrance" | "warmth" | "tint",
	number
>;

export const NEUTRAL_ADJUST: ColorAdjust = {
	exposure: 0,
	contrast: 0,
	highlights: 0,
	shadows: 0,
	saturation: 0,
	vibrance: 0,
	warmth: 0,
	tint: 0,
};

const labels: Record<AdjustKey, string> = {
	"adjust.exposure": "Exposure",
	"adjust.contrast": "Contrast",
	"adjust.highlights": "Highlights",
	"adjust.shadows": "Shadows",
	"adjust.saturation": "Saturation",
	"adjust.vibrance": "Vibrance",
	"adjust.warmth": "Warmth",
	"adjust.tint": "Tint",
};

export const ADJUST_PARAMS: ElementParamDefinition[] = ADJUST_KEYS.map((key) => ({
	key,
	label: labels[key],
	type: "number",
	default: 0,
	min: key === "adjust.exposure" ? -2 : -1,
	max: key === "adjust.exposure" ? 2 : 1,
	step: 0.01,
}));

function fieldOf(key: AdjustKey): keyof ColorAdjust {
	return key.slice("adjust.".length) as keyof ColorAdjust;
}

function readNumber(params: ParamValues, key: string): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A clip's adjustments as set, before keyframes. */
export function readAdjust(params: ParamValues): ColorAdjust {
	const adjust = { ...NEUTRAL_ADJUST };
	for (const key of ADJUST_KEYS) adjust[fieldOf(key)] = readNumber(params, key);
	return adjust;
}

/** A clip's adjustments at a moment, its keyframes applied. */
export function resolveAdjustAtTime({
	base,
	animations,
	localTime,
}: {
	base: ColorAdjust;
	animations: ElementAnimations | undefined;
	localTime: number;
}): ColorAdjust {
	const adjust = { ...base };
	for (const key of ADJUST_KEYS) {
		const field = fieldOf(key);
		adjust[field] = resolveNumberAtTime({
			baseValue: base[field],
			animations,
			propertyPath: key,
			localTime,
		});
	}
	return adjust;
}

export function isNeutralAdjust(adjust: ColorAdjust | undefined): boolean {
	return !adjust || Object.values(adjust).every((value) => Math.abs(value) < 1e-4);
}

/** A short key that changes whenever the adjustments do, for caching an adjusted frame. */
export function adjustKey(adjust: ColorAdjust): string {
	return Object.values(adjust)
		.map((value) => value.toFixed(4))
		.join(",");
}
