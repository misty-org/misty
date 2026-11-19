// Misty: caption style presets. Each is a set of the text element's own params (font, weight,
// size, color, background, outline, placement), plus karaoke for the one that lights words up
// as they're said. The Captions tab applies one to new captions and to the captions already on
// the timeline, and agents pick one by name (`video.edit` captions and captions_style).
import type { ParamValues } from "@opencut/params";
import { KARAOKE_DEFAULTS } from "@opencut/text/karaoke";
import { TEXT_STROKE_DEFAULTS } from "@opencut/text/stroke";
import type { SubtitleStyleOverrides } from "./types";

export const CAPTION_STYLES = [
	{ value: "plain", label: "Plain" },
	{ value: "serif", label: "Serif" },
	{ value: "bold", label: "Bold" },
	{ value: "karaoke", label: "Karaoke" },
] as const;

export type CaptionStyle = (typeof CAPTION_STYLES)[number]["value"];

export const DEFAULT_CAPTION_STYLE: CaptionStyle = "plain";

/** Marks a text clip as a caption and names its style. */
export const CAPTION_STYLE_KEY = "caption.style";

const styleNames = new Set<string>(CAPTION_STYLES.map((style) => style.value));

export function isCaptionStyle(value: unknown): value is CaptionStyle {
	return typeof value === "string" && styleNames.has(value);
}

interface CaptionLook {
	text: SubtitleStyleOverrides;
	stroke: { enabled: boolean; color: string; width: number };
	karaoke: { enabled: boolean; color: string };
}

const NO_STROKE = { ...TEXT_STROKE_DEFAULTS, enabled: false };
const NO_KARAOKE = { ...KARAOKE_DEFAULTS, enabled: false };

const LOOKS: Record<CaptionStyle, CaptionLook> = {
	// What captions looked like before there were styles.
	plain: {
		text: {
			fontFamily: "Arial",
			fontSize: 5,
			fontWeight: "bold",
			fontStyle: "normal",
			color: "#ffffff",
			background: { enabled: false, color: "#000000" },
		},
		stroke: NO_STROKE,
		karaoke: NO_KARAOKE,
	},
	serif: {
		text: {
			fontFamily: "Georgia",
			fontSize: 5,
			fontWeight: "normal",
			fontStyle: "normal",
			color: "#ffffff",
			background: {
				enabled: true,
				color: "#000000b3",
				cornerRadius: 20,
				paddingX: 54,
				paddingY: 42,
			},
		},
		stroke: NO_STROKE,
		karaoke: NO_KARAOKE,
	},
	bold: {
		text: {
			fontFamily: "Arial",
			fontSize: 6.5,
			fontWeight: "bold",
			fontStyle: "normal",
			color: "#ffffff",
			background: { enabled: false, color: "#000000" },
			placement: { verticalAlign: "bottom", marginVerticalRatio: 0.12 },
		},
		stroke: { enabled: true, color: "#000000", width: 22 },
		karaoke: NO_KARAOKE,
	},
	karaoke: {
		text: {
			fontFamily: "Arial",
			fontSize: 6,
			fontWeight: "bold",
			fontStyle: "normal",
			color: "#ffffff",
			background: { enabled: false, color: "#000000" },
			placement: { verticalAlign: "bottom", marginVerticalRatio: 0.12 },
		},
		stroke: { enabled: true, color: "#000000", width: 18 },
		karaoke: { enabled: true, color: KARAOKE_DEFAULTS.color },
	},
};

/** A style's text look, with a caption's own style (from a subtitle file) laid over it. */
export function captionStyleOverrides({
	style,
	own,
}: {
	style: CaptionStyle;
	own?: SubtitleStyleOverrides;
}): SubtitleStyleOverrides {
	const base = LOOKS[style].text;
	if (!own) return base;
	const background = own.background
		? { ...base.background, ...own.background }
		: base.background;
	const placement = own.placement
		? { ...base.placement, ...own.placement }
		: base.placement;
	return { ...base, ...own, background, placement };
}

/** The params a style sets beyond the text's look: outline, karaoke, and the style's name. */
export function captionStyleParams({ style }: { style: CaptionStyle }): ParamValues {
	const look = LOOKS[style];
	return {
		[CAPTION_STYLE_KEY]: style,
		"stroke.enabled": look.stroke.enabled,
		"stroke.color": look.stroke.color,
		"stroke.width": look.stroke.width,
		"karaoke.enabled": look.karaoke.enabled,
		"karaoke.color": look.karaoke.color,
	};
}
