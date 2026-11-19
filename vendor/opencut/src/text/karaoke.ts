// Misty: karaoke captions. A caption keeps the times its words were said (`caption.words`, from
// the speech recognizer or an agent), and while it shows, the words already said draw in the
// highlight color and the rest in the text's own. Like the rest of the text's look these are
// element params: the renderer works out how many words are said at a moment
// (services/renderer/resolve.ts) and drawMeasuredTextLayout colors them, so the preview and the
// export match. A caption whose words are missing, malformed or no longer match its text (it was
// retyped) draws plain.
import { TICKS_PER_SECOND } from "@opencut/wasm";
import type { ParamValues } from "@opencut/params";
import type { ElementParamDefinition } from "@opencut/params/registry";
import type { TextElement } from "@opencut/timeline";

/** The word times, as JSON `[[start, end], …]` in seconds from the caption's own start. */
export const CAPTION_WORDS_KEY = "caption.words";

export const KARAOKE_KEYS = ["karaoke.enabled", "karaoke.color"] as const;

export const KARAOKE_DEFAULTS = {
	enabled: false,
	color: "#ffd60a",
};

/** The most words one caption keeps times for. */
export const MAX_CAPTION_WORDS = 200;
/** No word time is later than this many seconds into its caption. */
export const MAX_CAPTION_WORD_SECONDS = 24 * 60 * 60;
const MAX_ENCODED_LENGTH = MAX_CAPTION_WORDS * 32;

export const KARAOKE_PARAMS: ElementParamDefinition[] = [
	{
		key: "karaoke.enabled",
		label: "Karaoke",
		type: "boolean",
		default: KARAOKE_DEFAULTS.enabled,
		keyframable: false,
	},
	{
		key: "karaoke.color",
		label: "Highlight color",
		type: "color",
		default: KARAOKE_DEFAULTS.color,
		keyframable: false,
		dependencies: [{ param: "karaoke.enabled", equals: true }],
	},
];

export interface CaptionWordTime {
	start: number;
	end: number;
}

const WORD = /\S+/g;

/** How many words a text has, split at whitespace, the way captions are laid out. */
export function countWords(text: string): number {
	return text.match(WORD)?.length ?? 0;
}

const roundMs = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * The times of a caption's words, one per word of its text and from the caption's own start,
 * or null when they don't line up with the text. `words` are in timeline seconds; a word whose
 * text has spaces in it counts as that many words, each with its time.
 */
export function alignCaptionWords({
	text,
	words,
	startTime,
	duration,
}: {
	text: string;
	words: ReadonlyArray<{ text: string; start: number; end: number }> | undefined;
	startTime: number;
	duration: number;
}): CaptionWordTime[] | null {
	if (!words || words.length === 0) return null;
	const times: CaptionWordTime[] = [];
	for (const word of words) {
		if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) return null;
		const tokens = countWords(word.text);
		for (let index = 0; index < tokens; index++) {
			const previous = times[times.length - 1];
			const start = Math.min(duration, Math.max(previous?.start ?? 0, word.start - startTime, 0));
			const end = Math.min(duration, Math.max(start, word.end - startTime));
			times.push({ start: roundMs(start), end: roundMs(end) });
		}
	}
	const count = countWords(text);
	if (count === 0 || count > MAX_CAPTION_WORDS || times.length !== count) return null;
	return times;
}

export function encodeCaptionWords(words: readonly CaptionWordTime[]): string {
	return JSON.stringify(words.map((word) => [roundMs(word.start), roundMs(word.end)]));
}

/** A caption's word times, or null when there are none or they aren't valid. */
export function decodeCaptionWords(value: unknown): CaptionWordTime[] | null {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENCODED_LENGTH) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_CAPTION_WORDS) {
		return null;
	}
	const words: CaptionWordTime[] = [];
	for (const entry of parsed) {
		if (!Array.isArray(entry) || entry.length !== 2) return null;
		const [start, end] = entry as unknown[];
		if (typeof start !== "number" || typeof end !== "number") return null;
		if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
		if (start < 0 || end < start || end > MAX_CAPTION_WORD_SECONDS) return null;
		const previous = words[words.length - 1];
		if (previous && start < previous.start) return null;
		words.push({ start, end });
	}
	return words;
}

/** How many words have begun by `seconds` into the caption. */
export function spokenWordCount({
	words,
	seconds,
}: {
	words: readonly CaptionWordTime[];
	seconds: number;
}): number {
	let count = 0;
	while (count < words.length && words[count].start <= seconds + 1e-6) count++;
	return count;
}

/**
 * Each line of a laid-out caption cut where its said words end: `spoken` draws in the highlight
 * color and `rest` (starting with the space after them) in the text's own.
 */
export function splitSpokenLines({
	lines,
	spokenWords,
}: {
	lines: readonly string[];
	spokenWords: number;
}): Array<{ spoken: string; rest: string }> {
	let remaining = Math.max(0, spokenWords);
	return lines.map((line) => {
		if (remaining === 0) return { spoken: "", rest: line };
		let cut = 0;
		for (const match of line.matchAll(WORD)) {
			if (remaining === 0) break;
			cut = (match.index ?? 0) + match[0].length;
			remaining--;
		}
		return { spoken: line.slice(0, cut), rest: line.slice(cut) };
	});
}

function readContent(params: ParamValues): string {
	return typeof params.content === "string" ? params.content : "";
}

/** The word times of a caption that can draw as karaoke: valid and one per word of its text. */
export function readCaptionWords({
	params,
}: {
	params: ParamValues;
}): CaptionWordTime[] | null {
	const words = decodeCaptionWords(params[CAPTION_WORDS_KEY]);
	return words && words.length === countWords(readContent(params)) ? words : null;
}

export interface KaraokeState {
	spokenWords: number;
	color: string;
}

/**
 * How a karaoke caption draws `elapsedTicks` after it starts on the timeline, or undefined when
 * it draws plain. A caption cut or trimmed at its start keeps time with its words through its
 * trimStart.
 */
export function resolveKaraoke({
	element,
	elapsedTicks,
}: {
	element: Pick<TextElement, "params" | "trimStart">;
	elapsedTicks: number;
}): KaraokeState | undefined {
	if (element.params["karaoke.enabled"] !== true) return undefined;
	const words = readCaptionWords({ params: element.params });
	if (!words) return undefined;
	const color = element.params["karaoke.color"];
	return {
		spokenWords: spokenWordCount({
			words,
			seconds: (elapsedTicks + element.trimStart) / TICKS_PER_SECOND,
		}),
		color: typeof color === "string" && color ? color : KARAOKE_DEFAULTS.color,
	};
}
