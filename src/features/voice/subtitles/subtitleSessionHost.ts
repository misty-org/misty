import type { LiveChannel } from "../liveTranscriber";
import type { SubtitleInput, SubtitlePrefs, SubtitlesView } from "./subtitlesView";

/**
 * A sliding window over the newest spoken segments: the one being said and the one before it. Older
 * ones are already read, so they drop off, and what was said and its translation cover the same
 * stretch of speech instead of the translation trailing far behind.
 */
export const SEGMENTS_SHOWN = 2;
export const FINISH_TIMEOUT_MS = 3000;
/** The stream each input arrives on. */
export const channelFor = (input: SubtitleInput): LiveChannel =>
  input === "mic" ? "mic" : "system";

export interface Host {
  prefs(): SubtitlePrefs;
  draw(next: Partial<SubtitlesView>): void;
  /** The session finished or failed, with what to tell the person. */
  ended(notice?: string): void;
}

interface Segment {
  sourceText: string;
  translatedText: string;
}

/**
 * How much stays on screen. Wide characters count double, since a line holds half as many of them.
 * What was said gets about two lines and its translation about three, as the panel draws them; if a
 * little more than fits, the panel slides the oldest words off the front.
 */
const SOURCE_WEIGHT = 170;
const TRANSLATION_WEIGHT = 340;

const weight = (text: string) =>
  Array.from(text).reduce((sum, char) => sum + (/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/u.test(char) ? 2 : 1), 0);

/**
 * A sliding window like subtitles: whole sentences, newest last, as many as fit the budget. The
 * sentence being said is always kept, and the ones before it stay until they'd push the window
 * past the budget, so words leave oldest first instead of the panel emptying at each full stop.
 */
export function lastSentences(text: string, budget: number) {
  const sentences = text.match(/[^。！？!?.…]+(?:[。！？!?.…]+["”’')\]）]*)?\s*/gu) ?? [text];
  let keep = 1;
  let total = weight(sentences[sentences.length - 1]);
  while (keep < sentences.length) {
    const next = weight(sentences[sentences.length - 1 - keep]);
    if (total + next > budget) break;
    total += next;
    keep++;
  }
  return sentences.slice(-keep).join("").trim();
}

/** The words on screen, joined as the target language writes them. */
export function heardText(segments: Segment[], target: string) {
  // These languages don't put spaces between sentences.
  const gap = /^(zh|ja)/i.test(target) ? "" : " ";
  return {
    source: lastSentences(
      segments
        .map((segment) => segment.sourceText.trim())
        .filter(Boolean)
        .join(" "),
      SOURCE_WEIGHT,
    ),
    translation: lastSentences(
      segments
        .map((segment) => segment.translatedText.trim())
        .filter(Boolean)
        .join(gap),
      TRANSLATION_WEIGHT,
    ),
  };
}

/** The lines kept in the saved session. */
export function savedLines(segments: Segment[]) {
  return segments
    .map((segment) => ({
      source: segment.sourceText.trim(),
      translation: segment.translatedText.trim(),
    }))
    .filter((line) => line.source || line.translation);
}
