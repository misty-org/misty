// Misty: changing the style of captions already on the timeline. A caption is a text clip that
// names its style (`caption.style`), or any text clip on a track named Captions (captions made
// before there were styles). Restyling lays each one out again in the new style, from its own
// words, and keeps its timing, word times, transitions and everything else that isn't the look.
import type { ParamValues } from "@opencut/params";
import type {
	OverlayTrack,
	SceneTracks,
	TextElement,
	TimelineElement,
	TimelineTrack,
} from "@opencut/timeline";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import {
	CAPTION_STYLE_KEY,
	DEFAULT_CAPTION_STYLE,
	isCaptionStyle,
	type CaptionStyle,
} from "./caption-style";

export const CAPTIONS_TRACK_NAME = "Captions";

/** The params a caption style sets, which a restyle replaces. */
const STYLED_KEYS = [
	"content",
	"fontSize",
	"fontFamily",
	"color",
	"textAlign",
	"fontWeight",
	"fontStyle",
	"textDecoration",
	"letterSpacing",
	"lineHeight",
	"background.enabled",
	"background.color",
	"background.cornerRadius",
	"background.paddingX",
	"background.paddingY",
	"background.offsetX",
	"background.offsetY",
	"transform.positionX",
	"transform.positionY",
	"stroke.enabled",
	"stroke.color",
	"stroke.width",
	"karaoke.enabled",
	"karaoke.color",
	CAPTION_STYLE_KEY,
] as const;

export function isCaptionElement({
	element,
	track,
}: {
	element: TimelineElement;
	track: TimelineTrack;
}): boolean {
	return (
		element.type === "text" &&
		(isCaptionStyle(element.params[CAPTION_STYLE_KEY]) ||
			track.name === CAPTIONS_TRACK_NAME)
	);
}

/** The style of the captions on the timeline, or null when there are none. */
export function captionTrackStyle({
	tracks,
}: {
	tracks: SceneTracks | null | undefined;
}): CaptionStyle | null {
	for (const track of tracks?.overlay ?? []) {
		if (track.type !== "text") continue;
		for (const element of track.elements) {
			if (!isCaptionElement({ element, track })) continue;
			const style = element.params[CAPTION_STYLE_KEY];
			return isCaptionStyle(style) ? style : DEFAULT_CAPTION_STYLE;
		}
	}
	return null;
}

/** One caption's params in a new style, or null when it has no words to lay out. */
export function restyleCaptionParams({
	element,
	style,
	canvasSize,
}: {
	element: TextElement;
	style: CaptionStyle;
	canvasSize: { width: number; height: number };
}): ParamValues | null {
	const content = element.params.content;
	const text = typeof content === "string" ? content.replace(/\s+/g, " ").trim() : "";
	if (!text) return null;
	const built = buildSubtitleTextElement({
		index: 0,
		caption: { text, startTime: 0, duration: 1 },
		canvasSize,
		captionStyle: style,
	});
	const params: ParamValues = { ...element.params };
	for (const key of STYLED_KEYS) {
		const value = built.params[key];
		if (value !== undefined) params[key] = value;
	}
	return params;
}

export interface CaptionRestyle {
	trackId: string;
	elementId: string;
	params: ParamValues;
}

/** The change each caption on the timeline takes to wear a style. */
export function captionRestyleUpdates({
	tracks,
	style,
	canvasSize,
}: {
	tracks: SceneTracks;
	style: CaptionStyle;
	canvasSize: { width: number; height: number };
}): CaptionRestyle[] {
	const updates: CaptionRestyle[] = [];
	for (const track of tracks.overlay) {
		if (track.type !== "text") continue;
		for (const element of track.elements) {
			if (!isCaptionElement({ element, track })) continue;
			const params = restyleCaptionParams({ element, style, canvasSize });
			if (params) updates.push({ trackId: track.id, elementId: element.id, params });
		}
	}
	return updates;
}

/** The tracks with every caption in a style, and how many captions changed. */
export function restyleCaptionTracks({
	tracks,
	style,
	canvasSize,
}: {
	tracks: SceneTracks;
	style: CaptionStyle;
	canvasSize: { width: number; height: number };
}): { tracks: SceneTracks; restyled: number } {
	const updates = captionRestyleUpdates({ tracks, style, canvasSize });
	if (updates.length === 0) return { tracks, restyled: 0 };
	const byElement = new Map(
		updates.map((update) => [`${update.trackId}\u0000${update.elementId}`, update.params]),
	);
	const overlay = tracks.overlay.map((track): OverlayTrack => {
		if (track.type !== "text") return track;
		return {
			...track,
			elements: track.elements.map((element) => {
				const params = byElement.get(`${track.id}\u0000${element.id}`);
				return params ? { ...element, params } : element;
			}),
		};
	});
	return { tracks: { ...tracks, overlay }, restyled: updates.length };
}
