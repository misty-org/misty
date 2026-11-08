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
const shortcuts = [
  { value: "", label: isMac ? "Fn / Globe" : "Right Alt" },
  ...(isMac
    ? [
        { value: "RightOption", label: "Right Option" },
        { value: "RightCommand", label: "Right Command" },
      ]
    : [{ value: "RightControl", label: "Right Ctrl" }]),
];
const languages = [
  { value: "auto", label: "Detect automatically" },
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
const sources = [
  { value: "mic", label: "Microphone" },
  { value: "mic-tab", label: "Microphone and this tab" },
  { value: "mic-system", label: "Microphone and system audio" },
  { value: "tab", label: "This tab only" },
  { value: "system", label: "System audio only" },
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
        <SettingsRow
          label="Dictation shortcut"

          muted={!voice.dictation}
        >
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
