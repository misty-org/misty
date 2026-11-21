import { invoke } from "@/native/invoke";
import type { DisplayCapture } from "./protocol";

/**
 * Hearing a spoken turn: the recognition streams Tutor feeds (one per language it listens in),
 * which language heard it best, and the line saved about what was on screen.
 */

export interface StreamPhrase {
  text?: string;
  confidence?: number;
}
export interface StreamHeard {
  segments?: StreamPhrase[];
  current?: StreamPhrase | null;
}

export const stopStreams = (streams: number[] | undefined) => {
  for (const stream of streams ?? [])
    void invoke("speech_stream_stop", { stream }).catch(() => undefined);
};

export const phrasesOf = (heard: StreamHeard) => [
  ...(heard.segments ?? []),
  ...(heard.current ? [heard.current] : []),
];

/**
 * What was said, from the language that heard it best: when Tutor listens in two languages, each
 * recognizer hears the same audio, and the one surer of its words (their confidence, weighed by
 * length) wins. With no confidence from either (an unfinished phrase), the one that heard more.
 * Phrase by phrase, so a person who switches language between sentences is followed.
 */
export function surest(heard: StreamPhrase[][]): string {
  const text = (phrase: StreamPhrase | undefined) => phrase?.text?.trim() ?? "";
  const [first = [], ...others] = heard;
  if (!others.length) return join(first.map(text));
  // Phrases end where the recognizer heard a pause, so the streams' phrases mostly line up.
  const longest = Math.max(first.length, ...others.map((phrases) => phrases.length));
  const aligned = heard.every((phrases) => phrases.length === longest);
  const choose = (candidates: StreamPhrase[]) =>
    candidates.reduce((best, phrase) => {
      const score = (candidate: StreamPhrase) =>
        (candidate.confidence ?? 0) * Math.max(1, text(candidate).length) ||
        text(candidate).length / 1000;
      return score(phrase) > score(best) ? phrase : best;
    });
  if (aligned)
    return join(
      Array.from({ length: longest }, (_, at) =>
        text(choose(heard.map((phrases) => phrases[at] ?? {}))),
      ),
    );
  // Phrases that don't line up: the whole of the surest stream.
  const whole = heard.map((phrases) => ({
    text: join(phrases.map(text)),
    confidence: average(phrases),
  }));
  return text(choose(whole));
}

/**
 * What was on screen for a turn, in a line built from its captures (never by a model): the window
 * in front's app and title and the page or document it had open, and how many screens there were.
 */
export function screenNote(screens: DisplayCapture[]): string {
  const front = screens.find((screen) => screen.source === "desktop-window");
  const displays = screens.filter((screen) => screen.source === "desktop-display").length;
  const parts = [
    front?.app && front.title && front.title !== front.app
      ? `${front.app}: ${front.title}`
      : front?.app || front?.title || "",
    front?.document ?? "",
    displays > 1 ? `${displays} screens` : "",
  ].filter(Boolean);
  return parts.join(", ").slice(0, 400);
}

const join = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").trim();

function average(phrases: StreamPhrase[]) {
  let sum = 0;
  let weight = 0;
  for (const phrase of phrases) {
    const length = phrase.text?.trim().length ?? 0;
    sum += (phrase.confidence ?? 0) * length;
    weight += length;
  }
  return weight ? sum / weight : 0;
}
