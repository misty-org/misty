import type { VoiceboxVoice } from "../voicebox";

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

export function voiceLabel(voice: VoiceboxVoice) {
  return voice.language ? `${voice.name} (${languageName(voice.language)})` : voice.name;
}
