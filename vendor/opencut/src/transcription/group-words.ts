// Misty: the computer's speech recognizer hears word by word, each word with its time; OpenCut's
// captions are built from phrases (buildCaptionChunks). This groups words into caption-sized
// phrases with their real start and end, breaking at a sentence's end or a pause, and keeps each
// phrase's words so its caption can light them up as they're said (text/karaoke.ts).
import type {
	CaptionChunk,
	TranscriptionSegment,
	TranscriptionWord,
} from "@opencut/transcription/types";
import {
	DEFAULT_WORDS_PER_CAPTION,
	MIN_CAPTION_DURATION_SECONDS,
} from "@opencut/transcription/caption-defaults";
import { buildCaptionChunks } from "@opencut/transcription/caption";

/** A silence this long, in seconds, starts a new caption. */
const PAUSE_SECONDS = 0.6;
/** The shortest a caption made from timed words lasts, in seconds. */
const MIN_TIMED_CAPTION_SECONDS = 0.05;

/** Words grouped into phrases, each phrase keeping its words. */
export function groupWordsIntoTimedPhrases(
	words: TranscriptionWord[],
	maxWords = DEFAULT_WORDS_PER_CAPTION,
): TranscriptionSegment[] {
	const phrases: TranscriptionSegment[] = [];
	let current: TranscriptionWord[] = [];
	const close = () => {
		if (current.length === 0) return;
		const phraseWords = current.map((word) => ({ ...word, text: word.text.trim() }));
		phrases.push({
			text: phraseWords.map((word) => word.text).join(" "),
			start: phraseWords[0].start,
			end: phraseWords[phraseWords.length - 1].end,
			words: phraseWords,
		});
		current = [];
	};
	for (const word of words) {
		if (!word.text.trim()) continue;
		const previous = current[current.length - 1];
		if (previous && word.start - previous.end >= PAUSE_SECONDS) close();
		current.push(word);
		if (current.length >= maxWords || /[.!?…]["”']?$/.test(word.text.trim())) close();
	}
	close();
	return phrases;
}

export function groupWordsIntoPhrases(
	words: TranscriptionSegment[],
	maxWords = DEFAULT_WORDS_PER_CAPTION,
): TranscriptionSegment[] {
	return groupWordsIntoTimedPhrases(words, maxWords).map(({ text, start, end }) => ({
		text,
		start,
		end,
	}));
}

/**
 * Captions from transcribed phrases. Phrases that carry their words keep their real times and
 * the words', each held on screen a little longer when short, up to the next one; otherwise
 * OpenCut's own chunking spreads each segment's words over it.
 */
export function captionChunksFromPhrases({
	segments,
}: {
	segments: TranscriptionSegment[];
}): CaptionChunk[] {
	const timed =
		segments.length > 0 && segments.every((segment) => (segment.words?.length ?? 0) > 0);
	if (!timed) return buildCaptionChunks({ segments });
	return segments.map((segment, index) => {
		const next = segments[index + 1];
		const held = Math.min(
			segment.start + MIN_CAPTION_DURATION_SECONDS,
			next ? next.start : Number.POSITIVE_INFINITY,
		);
		const end = Math.max(segment.end, held);
		return {
			text: segment.text,
			startTime: segment.start,
			duration: Math.max(MIN_TIMED_CAPTION_SECONDS, end - segment.start),
			words: segment.words,
		};
	});
}
