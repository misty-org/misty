import { stringSetting } from "@/features/settings/SettingsControls";
import { emptySubtitleContext, type SubtitleContext } from "./subtitleContext";
import { subtitleLanguages } from "./subtitleLanguages";
import { defaultSubtitlePrefs, type SubtitlePrefs } from "./subtitlesView";

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const bounded = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;

function readContext(value: unknown): SubtitleContext {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<SubtitleContext>;
  return {
    ...emptySubtitleContext(),
    category: text(raw.category, "general"),
    customCategory: text(raw.customCategory).slice(0, 160),
    text: text(raw.text).slice(0, 10_000),
    terms: Array.isArray(raw.terms) ? raw.terms.filter((term) => typeof term === "string") : [],
    translationTerms: Array.isArray(raw.translationTerms)
      ? raw.translationTerms.filter(
          (term) => typeof term?.source === "string" && typeof term?.target === "string",
        )
      : [],
  };
}

const isLanguage = (value: unknown) =>
  typeof value === "string" && subtitleLanguages.some((language) => language.value === value);

/** This computer's language, for someone who hasn't chosen one. */
function computerLanguage() {
  const code = (navigator.language || "en").split("-")[0].toLowerCase();
  return isLanguage(code) ? code : "en";
}

/** Reads what's saved; anything unusable falls back to the default for that one control. */
export function parseSubtitlePrefs(saved: string): SubtitlePrefs {
  let raw: Partial<SubtitlePrefs> = {};
  try {
    const parsed: unknown = JSON.parse(saved);
    if (parsed && typeof parsed === "object") raw = parsed as Partial<SubtitlePrefs>;
  } catch {
    // Unreadable preferences start over.
  }
  const fallback = defaultSubtitlePrefs;
  return {
    mode: raw.mode === "subtitles" ? "subtitles" : "translate",
    source: raw.source === "auto" || isLanguage(raw.source) ? (raw.source as string) : "auto",
    target: isLanguage(raw.target) ? (raw.target as string) : computerLanguage(),
    context: readContext(raw.context),
    input: raw.input === "mic" ? "mic" : "system",
    gain: bounded(raw.gain, 0, 1, fallback.gain),
    muted: raw.muted === true,
    silenceSeconds: bounded(raw.silenceSeconds, 10, 300, fallback.silenceSeconds),
    silenceDbfs: bounded(raw.silenceDbfs, -80, -30, fallback.silenceDbfs),
    save: raw.save === true,
  };
}

export function savedSubtitlePrefs(document: Record<string, unknown> | undefined) {
  return parseSubtitlePrefs(stringSetting(document ?? {}, "voice", "subtitle_preferences", "{}"));
}

/** Scales 16-bit little-endian samples; a gain of 1 leaves them untouched. */
export function scalePcm(pcm: Uint8Array, gain: number) {
  if (gain >= 1) return pcm;
  const out = new Uint8Array(pcm.length);
  if (gain <= 0) return out;
  const from = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const to = new DataView(out.buffer);
  for (let at = 0; at + 1 < pcm.length; at += 2) {
    to.setInt16(at, Math.round(from.getInt16(at, true) * gain), true);
  }
  return out;
}
