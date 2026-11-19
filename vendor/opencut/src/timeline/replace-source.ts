// Misty: swapping a clip's media for another file at the same place and timing (the cleaned
// voice, the upscaled shot), for the timeline's "Replace media" and agents' `replace_source`.
// The clip keeps its start, trim, params, effects, masks, keyframes and speed; only what it
// shows or plays changes. When the new file is too short for the stretch of source the clip
// plays, the clip is shortened to end where the file ends, and on the main track what follows
// moves up to close the gap.
import { clampAnimationsToDuration } from "@opencut/animation";
import { getSourceSpanAtClipTime, getTimelineDurationForSourceSpan } from "@opencut/retime";
import {
	mediaTimeFromSeconds,
	roundMediaTime,
	TICKS_PER_SECOND,
	type MediaTime,
} from "@opencut/wasm";
import type { MediaType } from "@opencut/media/types";
import type { SceneTracks, TimelineElement, TimelineTrack } from "./types";
import { hasMediaId, isRetimableElement } from "./element-utils";

export interface ReplacementMedia {
	/** The media asset the clip will point at. */
	assetId: string;
	type: MediaType;
	name: string;
	/** Its length in seconds; photos have none. */
	duration?: number;
	hasAudio?: boolean;
}

export interface ReplacedSource {
	tracks: SceneTracks;
	/** How much shorter the clip became, in ticks; 0 when the new file covers it. */
	shortenedBy: number;
}

/** Why a clip can't take this kind of media, or null when it can. */
export function replacementMismatch({
	element,
	media,
}: {
	element: TimelineElement;
	media: Pick<ReplacementMedia, "type" | "hasAudio">;
}): string | null {
	if (!hasMediaId(element)) {
		return "Only a video, photo or sound clip has media to replace.";
	}
	if (element.type === "video") {
		if (media.type === "video") return null;
		return media.type === "audio"
			? "A video clip can't take a sound: put the sound on an audio track and mute the clip, or replace its separated audio clip."
			: "A video clip takes a video, not a photo.";
	}
	if (element.type === "image") {
		return media.type === "image" ? null : "A photo clip takes a photo.";
	}
	if (media.type === "audio") return null;
	return media.type === "video" && media.hasAudio !== false
		? null
		: "A sound clip takes a sound, or a video with sound.";
}

function seconds(ticks: number): string {
	return `${Math.round((ticks / TICKS_PER_SECOND) * 100) / 100}s`;
}

/** The clip with its media swapped, and how many ticks shorter it had to become. */
function replaceOne({
	element,
	media,
}: {
	element: TimelineElement;
	media: ReplacementMedia;
}): { element: TimelineElement; shortenedBy: number } {
	const mismatch = replacementMismatch({ element, media });
	if (mismatch) throw new Error(mismatch);
	const swapped = {
		...element,
		mediaId: media.assetId,
		name: media.name,
	} as TimelineElement;
	// A decoded sound belongs to the old file.
	if ("buffer" in swapped) delete (swapped as { buffer?: AudioBuffer }).buffer;
	if (element.type === "image" || media.duration === undefined) {
		return { element: swapped, shortenedBy: 0 };
	}

	const retime = isRetimableElement(element) ? element.retime : undefined;
	const sourceLength = roundMediaTime({
		time: mediaTimeFromSeconds({ seconds: media.duration }),
	});
	const span = roundMediaTime({
		time: getSourceSpanAtClipTime({ clipTime: element.duration, retime }),
	});
	const available = sourceLength - element.trimStart;
	if (available <= 0) {
		throw new Error(
			`“${media.name}” is ${seconds(sourceLength)} long, but this clip starts ${seconds(element.trimStart)} into its media.`,
		);
	}
	if (span <= available) {
		return {
			element: {
				...swapped,
				trimEnd: (available - span) as MediaTime,
				sourceDuration: sourceLength as MediaTime,
			} as TimelineElement,
			shortenedBy: 0,
		};
	}
	const duration = Math.max(
		1,
		Math.min(
			element.duration,
			roundMediaTime({
				time: getTimelineDurationForSourceSpan({ sourceSpan: available, retime }),
			}),
		),
	) as MediaTime;
	return {
		element: {
			...swapped,
			duration,
			trimEnd: 0 as MediaTime,
			sourceDuration: sourceLength as MediaTime,
			animations: clampAnimationsToDuration({
				animations: element.animations,
				duration,
			}),
		} as TimelineElement,
		shortenedBy: element.duration - duration,
	};
}

/**
 * Swaps the media of the clip `elementId` for `media`. Throws with a reason a person can read
 * when the clip has no media or can't take that kind (a sound into a video clip), or when the
 * new file ends before the point the clip starts playing it from.
 */
export function replaceElementSource({
	tracks,
	elementId,
	media,
}: {
	tracks: SceneTracks;
	elementId: string;
	media: ReplacementMedia;
}): ReplacedSource {
	let shortenedBy = 0;
	let found = false;
	const mapTrack = <T extends TimelineTrack>(track: T): T => {
		const elements = track.elements as TimelineElement[];
		const original = elements.find((element) => element.id === elementId);
		if (!original) return track;
		found = true;
		const replaced = replaceOne({ element: original, media });
		shortenedBy = replaced.shortenedBy;
		const end = original.startTime + original.duration;
		const isMain = track.id === tracks.main.id;
		return {
			...track,
			elements: elements.map((element) => {
				if (element.id === elementId) return replaced.element;
				// The main track's clips follow one another, so the ones after move up.
				if (isMain && shortenedBy > 0 && element.startTime >= end) {
					return {
						...element,
						startTime: (element.startTime - shortenedBy) as MediaTime,
					} as TimelineElement;
				}
				return element;
			}),
		} as T;
	};
	const next: SceneTracks = {
		main: mapTrack(tracks.main),
		overlay: tracks.overlay.map(mapTrack),
		audio: tracks.audio.map(mapTrack),
	};
	if (!found) throw new Error("That clip isn't in this scene.");
	return { tracks: next, shortenedBy };
}
