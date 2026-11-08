import type { LiveChannel } from "../liveTranscriber";
import type { SubtitlePrefs, SubtitlesView } from "./subtitlesView";

/** More than the window can show, so the words always fill it. */
export const SEGMENTS_SHOWN = 12;
export const FINISH_TIMEOUT_MS = 3000;
/** Subtitles don't wait longer than this for the model; its answer is used when it comes. */
export const CONTEXT_WAIT_MS = 6000;
export const AUDIO_RETRY_MS = 1000;
export const PAGE_CHECK_MS = 3000;
/** A page that redirects twice shouldn't restart the stream twice. */
export const PAGE_CHANGE_GAP_MS = 15_000;
export const CHANNEL: LiveChannel = "system";
/** `voice_capture_start`'s answer when no tab has made a sound yet. */
export const TABS_SILENT = "misty_tabs_silent";

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** The words on screen, joined as the target language writes them. */
export function heardText(segments: Segment[], target: string) {
  // These languages don't put spaces between sentences.
  const gap = /^(zh|ja)/i.test(target) ? "" : " ";
  return {
    source: segments
      .map((segment) => segment.sourceText.trim())
      .filter(Boolean)
      .join(" "),
    translation: segments
      .map((segment) => segment.translatedText.trim())
      .filter(Boolean)
      .join(gap),
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
