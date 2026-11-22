import type { VoiceView } from "../speechModels";

/** The languages Misty hears and speaks in, for Settings › Voice and setup: text alone, since
 * one icon repeated down the list would tell them apart from nothing. */
export const speechLanguages = [
  { value: "auto", label: "System language" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "ru", label: "Russian" },
];

/** What a voice says when it's tried out. */
export const voiceSample = "Hi, I'm Misty. This is how I sound.";

/** A language's name in the person's own, such as "English" for "en". */
function languageName(code: string) {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A voice as a choice reads: its name, then its accent or its language. */
export function voiceLabel(voice: VoiceView) {
  const language = voice.languages.find((code) => code !== "*");
  const where = voice.accent ?? (language ? languageName(language) : undefined);
  return where ? `${voice.name} (${where})` : voice.name;
}
