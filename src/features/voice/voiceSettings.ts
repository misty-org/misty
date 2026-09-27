import { booleanSetting, stringSetting } from "@/features/settings/SettingsControls";

export type DictationStyle = "plain" | "casual" | "formal";
export type CaptureSources = "mic" | "mic-tab" | "mic-system" | "tab" | "system";

/** Settings › Voice, read from the device's settings document. */
export interface VoiceSettings {
  dictation: boolean;
  /** Empty means the platform default (Fn/Globe, or Right Alt on Windows). */
  shortcut: string;
  handsFree: boolean;
  cleanup: boolean;
  style: DictationStyle;
  /** "auto" or a language code. */
  language: string;
  /** One term per line. */
  dictionary: string[];
  agentHandoff: boolean;
  captureSources: CaptureSources;
  keepRecordings: boolean;
}

const styles: DictationStyle[] = ["plain", "casual", "formal"];
const sources: CaptureSources[] = ["mic", "mic-tab", "mic-system", "tab", "system"];

export function voiceSettings(document: Record<string, unknown> | undefined): VoiceSettings {
  const doc = document ?? {};
  const style = stringSetting(doc, "voice", "dictation_style", "plain") as DictationStyle;
  const capture = stringSetting(doc, "voice", "capture_sources", "mic-tab") as CaptureSources;
  return {
    dictation: booleanSetting(doc, "voice", "dictation_enabled", true),
    shortcut: stringSetting(doc, "voice", "dictation_shortcut", ""),
    handsFree: booleanSetting(doc, "voice", "dictation_hands_free", true),
    cleanup: booleanSetting(doc, "voice", "dictation_cleanup", true),
    style: styles.includes(style) ? style : "plain",
    language: stringSetting(doc, "voice", "language", "auto") || "auto",
    dictionary: stringSetting(doc, "voice", "dictionary", "")
      .split("\n")
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 200),
    agentHandoff: booleanSetting(doc, "voice", "agent_handoff", true),
    captureSources: sources.includes(capture) ? capture : "mic-tab",
    keepRecordings: booleanSetting(doc, "voice", "keep_recordings", false),
  };
}
