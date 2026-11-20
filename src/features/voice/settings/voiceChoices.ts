import type { SystemVoice } from "../systemSpeech";

/**
 * The system voices Settings › Voice offers: the ones for the language Misty speaks in, the best
 * first. macOS names its downloaded voices "… (Premium)" and "… (Enhanced)", which sound far more
 * natural than the compact ones, so those lead.
 */

/** A voice's quality as its name says it: 2 Premium, 1 Enhanced, 0 the rest. */
export function voiceQuality(voice: Pick<SystemVoice, "name">): number {
  if (/\bpremium\b/i.test(voice.name)) return 2;
  if (/\benhanced\b/i.test(voice.name)) return 1;
  return 0;
}

/** The language code a voice speaks ("en" for "en_US" or "en-GB"). */
const languageOf = (voice: Pick<SystemVoice, "language">) =>
  voice.language.toLowerCase().split(/[-_]/)[0] ?? "";

/**
 * The voices for `language` ("auto" is the system's own, `systemLanguage`), Premium, then
 * Enhanced, then the rest, each group by name. The chosen voice stays in the list whatever it
 * speaks, so a choice is never hidden.
 */
export function voicesFor(
  voices: readonly SystemVoice[],
  language: string,
  chosen: string,
  systemLanguage: string,
): SystemVoice[] {
  const wanted = (language === "auto" ? systemLanguage : language).toLowerCase().split(/[-_]/)[0];
  const offered = voices.filter((voice) => languageOf(voice) === wanted || voice.id === chosen);
  return [...(offered.length ? offered : voices)].sort(
    (a, b) => voiceQuality(b) - voiceQuality(a) || a.name.localeCompare(b.name),
  );
}

/** Whether the language has a Premium or Enhanced voice installed. */
export const hasNaturalVoice = (voices: readonly SystemVoice[]) =>
  voices.some((voice) => voiceQuality(voice) > 0);
