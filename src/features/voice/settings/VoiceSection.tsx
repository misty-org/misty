import { AudioLines, Keyboard, Languages, Mic, MonitorSpeaker } from "lucide-react";
import { voiceSettings } from "../voiceSettings";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import {
  ChoiceControl,
  DropdownControl,
  SwitchControl,
  TextAreaControl,
} from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
// The empty value is the platform's own dictation key.
const shortcuts = [
  { value: "", label: isMac ? "Fn / Globe" : "Right Alt", icon: Keyboard },
  ...(isMac
    ? [
        { value: "RightOption", label: "Right Option", icon: Keyboard },
        { value: "RightCommand", label: "Right Command", icon: Keyboard },
      ]
    : [{ value: "RightControl", label: "Right Ctrl", icon: Keyboard }]),
];
const languages = [
  { value: "auto", label: "Detect automatically", icon: Languages },
  { value: "en", label: "English", icon: Languages },
  { value: "es", label: "Spanish", icon: Languages },
  { value: "fr", label: "French", icon: Languages },
  { value: "de", label: "German", icon: Languages },
  { value: "it", label: "Italian", icon: Languages },
  { value: "pt", label: "Portuguese", icon: Languages },
  { value: "nl", label: "Dutch", icon: Languages },
  { value: "ja", label: "Japanese", icon: Languages },
  { value: "ko", label: "Korean", icon: Languages },
  { value: "zh", label: "Chinese", icon: Languages },
  { value: "hi", label: "Hindi", icon: Languages },
  { value: "ru", label: "Russian", icon: Languages },
];
const sources = [
  { value: "mic", label: "Microphone", icon: Mic },
  { value: "mic-system", label: "Microphone and system audio", icon: AudioLines },
  { value: "system", label: "System audio only", icon: MonitorSpeaker },
];

/** Settings › Voice: dictation everywhere and voice captures. Device-only. */
export function VoiceSection(props: SettingsContentProps) {
  const voice = voiceSettings(props.document);
  const set = (key: string, value: string | boolean) => props.onSettingChange("voice", key, value);
  const dictationOff = props.working || !voice.dictation;
  return (
    <>
      <SettingsSectionBlock title="Dictation">
        <SettingsRow label="Dictation" description="Hold a key and speak to type in any app.">
          <SwitchControl
            checked={voice.dictation}
            disabled={props.working}
            onChange={(value) => set("dictation_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow label="Dictation shortcut" muted={!voice.dictation}>
          <DropdownControl
            value={voice.shortcut}
            options={shortcuts}
            disabled={dictationOff}
            onValueChange={(value) => set("dictation_shortcut", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Hands-free double-tap"
          description="Double-tap to keep listening."
          muted={!voice.dictation}
        >
          <SwitchControl
            checked={voice.handsFree}
            disabled={dictationOff}
            onChange={(value) => set("dictation_hands_free", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="AI cleanup"
          description="Fixes punctuation and drops filler words before typing, in the style you pick. Uses your fast model."
          muted={!voice.dictation}
        >
          <ChoiceControl
            value={voice.cleanup ? voice.style : "off"}
            options={[
              { value: "off", label: "Off" },
              { value: "plain", label: "Plain" },
              { value: "casual", label: "Casual" },
              { value: "formal", label: "Formal" },
            ]}
            disabled={dictationOff}
            onValueChange={(value) => {
              set("dictation_cleanup", value !== "off");
              if (value !== "off") set("dictation_style", value);
            }}
          />
        </SettingsRow>
        <SettingsRow
          label="Hand off to agents by name"
          description={'"Hey" and an agent’s name sends the rest to that agent.'}
          muted={!voice.dictation}
        >
          <SwitchControl
            checked={voice.agentHandoff}
            disabled={dictationOff}
            onChange={(value) => set("agent_handoff", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="Speech">
        <SettingsRow label="Language">
          <DropdownControl
            value={voice.language}
            options={languages}
            disabled={props.working}
            onValueChange={(value) => set("language", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Personal dictionary"
          description="Names and terms, one per line."
          stacked
        >
          <TextAreaControl
            value={voice.dictionary.join("\n")}
            placeholder={"Misty\nSoniox"}
            rows={4}
            disabled={props.working}
            onCommit={(value) => set("dictionary", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="Listening">
        <SettingsRow label="Default sources">
          <DropdownControl
            value={voice.captureSources}
            options={sources}
            disabled={props.working}
            onValueChange={(value) => set("capture_sources", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
