import type { VoiceView } from "../speech_models";

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

export const voiceSample = "Hi, I'm Misty. This is how I sound.";

function languageName(code: string) {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function voiceLabel(voice: VoiceView) {
  const language = voice.languages.find((code) => code !== "*");
  const where = voice.accent ?? (language ? languageName(language) : undefined);
  return where ? `${voice.name} (${where})` : voice.name;
}
