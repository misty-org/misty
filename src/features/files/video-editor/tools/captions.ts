import type { SceneTracks, TextElement, TextTrack } from "@opencut/timeline";
import { buildSubtitleTextElement } from "@opencut/subtitles/build-subtitle-text-element";
import {
  CAPTION_STYLES,
  DEFAULT_CAPTION_STYLE,
  isCaptionStyle,
  type CaptionStyle,
} from "@opencut/subtitles/caption-style";
import { CAPTIONS_TRACK_NAME, restyleCaptionTracks } from "@opencut/subtitles/restyle";
import { countWords, MAX_CAPTION_WORDS } from "@opencut/text/karaoke";
import { buildEmptyTrack } from "@opencut/timeline/placement/track-factory";
import { generateUUID } from "@opencut/utils/id";
import type { DocumentEditHandler } from "./documentEdits";
import { copyDocument, projectOf, sceneOf } from "./projectModel";

/*
 * Captions as agents make them: a track of text clips, one per phrase, in one of the caption
 * styles (vendor/opencut/src/subtitles/caption-style.ts). A phrase may carry its words with
 * their times (from video.transcript), which karaoke lights up as they're said.
 */

export const CAPTION_LIMITS = {
  phrases: 2000,
  phraseText: 300,
  words: MAX_CAPTION_WORDS,
  wordText: 80,
  /** The latest time, in seconds, a caption may end. */
  seconds: 24 * 60 * 60,
} as const;

/** How far, in seconds, a word may start before or end after its phrase, then held inside it. */
const WORD_SLACK_SECONDS = 0.05;
/** Phrases overlapping by less than this, in seconds, are taken as touching. */
const OVERLAP_SLACK_SECONDS = 0.001;

export type CaptionWord = { text: string; start: number; end: number };
export type CaptionPhrase = { text: string; start: number; end: number; words?: CaptionWord[] };
export type CaptionsEdit = { op: "captions"; phrases: CaptionPhrase[]; style?: CaptionStyle };
export type CaptionsStyleEdit = { op: "captions_style"; style: CaptionStyle };

const fail = (message: string): never => {
  throw new Error(message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const styleNames = CAPTION_STYLES.map((style) => style.value).join(", ");

/** A caption style by name: one of plain, serif, bold, karaoke. */
export function checkedCaptionStyle(value: unknown): CaptionStyle {
  if (value === undefined) return DEFAULT_CAPTION_STYLE;
  return isCaptionStyle(value) ? value : fail(`The caption style is one of ${styleNames}.`);
}

function checkedWords(
  raw: unknown,
  phrase: CaptionPhrase,
  name: string,
): CaptionWord[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return fail(`${name}'s words are a list of {text, start, end}.`);
  if (raw.length === 0) return undefined;
  if (raw.length > CAPTION_LIMITS.words)
    fail(`${name} has more than ${CAPTION_LIMITS.words} words; split it into shorter phrases.`);
  const words: CaptionWord[] = [];
  raw.forEach((entry: unknown, index) => {
    const word = `${name}'s word ${index + 1}`;
    if (!isRecord(entry)) return fail(`${word} is {text, start, end}.`);
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!text) fail(`${word} needs its text.`);
    if (text.length > CAPTION_LIMITS.wordText)
      fail(`${word} is longer than ${CAPTION_LIMITS.wordText} characters.`);
    if (!isTime(entry.start) || !isTime(entry.end))
      fail(`${word} needs a start and end in seconds.`);
    const start = entry.start as number;
    const end = entry.end as number;
    if (end < start) fail(`${word} needs a start before its end.`);
    if (start < phrase.start - WORD_SLACK_SECONDS || end > phrase.end + WORD_SLACK_SECONDS)
      fail(`${word} is outside its phrase (${phrase.start}s to ${phrase.end}s).`);
    const previous = words[words.length - 1];
    if (previous && start < previous.start)
      fail(`${word} starts before the word ahead of it; give the words in the order they're said.`);
    const heldStart = Math.min(phrase.end, Math.max(phrase.start, start));
    words.push({ text, start: heldStart, end: Math.min(phrase.end, Math.max(heldStart, end)) });
  });
  const said = words.reduce((count, word) => count + countWords(word.text), 0);
  if (said !== countWords(phrase.text))
    fail(
      `${name}'s words don't match its text: it has ${countWords(phrase.text)} words and ${said} were given.`,
    );
  return words;
}

/** Phrases as agents give them, checked, in time order. */
export function checkedCaptionPhrases(raw: unknown): CaptionPhrase[] {
  if (!Array.isArray(raw) || raw.length === 0) return fail("Captions need at least one phrase.");
  if (raw.length > CAPTION_LIMITS.phrases)
    fail(`Captions take at most ${CAPTION_LIMITS.phrases} phrases at once.`);
  const phrases = raw.map((entry: unknown, index) => {
    const name = `Phrase ${index + 1}`;
    if (!isRecord(entry)) return fail(`${name} is {text, start, end}.`);
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!text) fail(`${name} needs its text.`);
    if (text.length > CAPTION_LIMITS.phraseText)
      fail(`${name} is longer than ${CAPTION_LIMITS.phraseText} characters; split it.`);
    if (!isTime(entry.start) || !isTime(entry.end))
      fail(`${name} needs a start and end in seconds.`);
    const start = entry.start as number;
    const end = entry.end as number;
    if (start < 0) fail(`${name} starts before the video does.`);
    if (!(end > start)) fail(`${name} needs a start before its end.`);
    if (end > CAPTION_LIMITS.seconds) fail(`${name} ends too late.`);
    const phrase: CaptionPhrase = { text, start, end };
    const words = checkedWords(entry.words, phrase, name);
    return { name, phrase: words ? { ...phrase, words } : phrase };
  });
  const ordered = [...phrases].sort((a, b) => a.phrase.start - b.phrase.start);
  return ordered.map(({ name, phrase }, index) => {
    const next = ordered[index + 1];
    if (!next || next.phrase.start >= phrase.end) return phrase;
    if (phrase.end - next.phrase.start > OVERLAP_SLACK_SECONDS || next.phrase.start <= phrase.start)
      fail(
        `${name} and ${next.name.toLowerCase()} overlap; each phrase starts after the one before ends.`,
      );
    return { ...phrase, end: next.phrase.start };
  });
}

/** The captions track's clips: one per phrase, in the style asked for (plain if none). */
export function buildCaptionElements(
  input: { phrases: unknown; style?: unknown },
  canvas: { width: number; height: number },
): TextElement[] {
  const style = checkedCaptionStyle(input.style);
  const phrases = checkedCaptionPhrases(input.phrases);
  if (style === "karaoke" && !phrases.some((phrase) => phrase.words))
    fail(
      "Karaoke captions need each phrase's words with their times (video.transcript gives them).",
    );
  return phrases.map(
    (phrase, index) =>
      ({
        ...buildSubtitleTextElement({
          index,
          caption: {
            text: phrase.text,
            startTime: phrase.start,
            duration: phrase.end - phrase.start,
            words: phrase.words,
          },
          canvasSize: canvas,
          captionStyle: style,
        }),
        id: generateUUID(),
      }) as TextElement,
  );
}

/** A captions track of its own, named Captions. */
export function buildCaptionTrack(
  input: { phrases: unknown; style?: unknown },
  canvas: { width: number; height: number },
): TextTrack {
  return {
    ...buildEmptyTrack({ id: generateUUID(), type: "text", name: CAPTIONS_TRACK_NAME }),
    elements: buildCaptionElements(input, canvas),
  };
}

/** The tracks with a new captions track above the rest: the `captions` edit. */
export function addCaptionTrack(
  tracks: SceneTracks,
  input: { phrases: unknown; style?: unknown },
  canvas: { width: number; height: number },
): SceneTracks {
  return { ...tracks, overlay: [buildCaptionTrack(input, canvas), ...tracks.overlay] };
}

/** The `captions_style` edit: every caption in the video takes a style, laid out again in it. */
export const restyleCaptions: DocumentEditHandler<{ style: unknown }> = async (document, edit) => {
  const style = isCaptionStyle(edit.style)
    ? edit.style
    : fail(`The caption style is one of ${styleNames}.`);
  const next = copyDocument(document);
  const project = projectOf(next);
  const scene = sceneOf(project);
  const { tracks, restyled } = restyleCaptionTracks({
    tracks: scene.tracks,
    style,
    canvasSize: project.settings.canvasSize,
  });
  if (restyled === 0) fail("This video has no captions yet; add them with the captions edit.");
  scene.tracks = tracks;
  return next;
};
