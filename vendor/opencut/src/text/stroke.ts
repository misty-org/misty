// Misty: an outline around text, which OpenCut's text element doesn't have, so captions read on
// any picture. It is an element param like the rest of the text's look, drawn under the fill by
// drawMeasuredTextLayout, so the preview and the export draw it the same.
import type { ParamValues } from "@opencut/params";
import type { ElementParamDefinition } from "@opencut/params/registry";

export const TEXT_STROKE_KEYS = [
	"stroke.enabled",
	"stroke.color",
	"stroke.width",
] as const;

export const TEXT_STROKE_DEFAULTS = {
	enabled: false,
	color: "#000000",
	/** The outline's line width, as a percentage of the font size. */
	width: 16,
};

const STROKE_WIDTH_MIN = 1;
const STROKE_WIDTH_MAX = 40;

export const TEXT_STROKE_PARAMS: ElementParamDefinition[] = [
	{
		key: "stroke.enabled",
		label: "Outline",
		type: "boolean",
		default: TEXT_STROKE_DEFAULTS.enabled,
		keyframable: false,
	},
	{
		key: "stroke.color",
		label: "Outline color",
		type: "color",
		default: TEXT_STROKE_DEFAULTS.color,
		keyframable: false,
		dependencies: [{ param: "stroke.enabled", equals: true }],
	},
	{
		key: "stroke.width",
		label: "Outline width",
		type: "number",
		default: TEXT_STROKE_DEFAULTS.width,
		min: STROKE_WIDTH_MIN,
		max: STROKE_WIDTH_MAX,
		step: 1,
		keyframable: false,
		dependencies: [{ param: "stroke.enabled", equals: true }],
	},
];

export interface TextStroke {
	color: string;
	/** Canvas line width in pixels. */
	lineWidth: number;
}

/** The text's outline at a font size in pixels, or null when it has none. */
export function readTextStroke({
	params,
	scaledFontSize,
}: {
	params: ParamValues;
	scaledFontSize: number;
}): TextStroke | null {
	if (params["stroke.enabled"] !== true) return null;
	const color =
		typeof params["stroke.color"] === "string" && params["stroke.color"]
			? params["stroke.color"]
			: TEXT_STROKE_DEFAULTS.color;
	const raw = params["stroke.width"];
	const width =
		typeof raw === "number" && Number.isFinite(raw)
			? Math.min(STROKE_WIDTH_MAX, Math.max(STROKE_WIDTH_MIN, raw))
			: TEXT_STROKE_DEFAULTS.width;
	const lineWidth = (scaledFontSize * width) / 100;
	return lineWidth > 0 ? { color, lineWidth } : null;
}
