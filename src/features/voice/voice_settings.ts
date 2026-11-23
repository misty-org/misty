import { booleanSetting, stringSetting } from "@/features/settings/SettingsControls";

export type DictationStyle = "plain" | "casual" | "formal";
export type CaptureSources = "mic" | "mic-system" | "system";

export interface VoiceSettings {
  dictation: boolean;
  shortcut: string;
  handsFree: boolean;
  cleanup: boolean;
  style: DictationStyle;
  language: string;
  secondLanguage: string;
  dictionary: string[];
  agentHandoff: boolean;
  captureSources: CaptureSources;
  voice: string;
  hearingModel: string;
  speakingRate: number;
}

const rates = ["0.75", "1", "1.25", "1.5"];

const styles: DictationStyle[] = ["plain", "casual", "formal"];
const sources: CaptureSources[] = ["mic", "mic-system", "system"];
const retiredSources: Record<string, CaptureSources> = { "mic-tab": "mic-system", tab: "system" };

export function voiceSettings(document: Record<string, unknown> | undefined): VoiceSettings {
  const doc = document ?? {};
  const style = stringSetting(doc, "voice", "dictation_style", "plain") as DictationStyle;
  const stored = stringSetting(doc, "voice", "capture_sources", "mic-system");
  const capture = (retiredSources[stored] ?? stored) as CaptureSources;
  return {
    dictation: booleanSetting(doc, "voice", "dictation_enabled", true),
    shortcut: stringSetting(doc, "voice", "dictation_shortcut", ""),
    handsFree: booleanSetting(doc, "voice", "dictation_hands_free", true),
    cleanup: booleanSetting(doc, "voice", "dictation_cleanup", true),
    style: styles.includes(style) ? style : "plain",
    language: stringSetting(doc, "voice", "language", "auto") || "auto",
    secondLanguage: stringSetting(doc, "voice", "second_language", "none") || "none",
    dictionary: stringSetting(doc, "voice", "dictionary", "")
      .split("\n")
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 200),
    agentHandoff: booleanSetting(doc, "voice", "agent_handoff", true),
    captureSources: sources.includes(capture) ? capture : "mic-system",
    voice: stringSetting(doc, "voice", "speaking_voice", ""),
    hearingModel: stringSetting(doc, "voice", "hearing_model", ""),
    speakingRate: Number(
      rates.find((rate) => rate === stringSetting(doc, "voice", "speaking_rate", "1")) ?? "1",
    ),
  };
}
