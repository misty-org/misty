import { voiceSettings } from "@/features/voice";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import {
  ChoiceControl,
  DropdownControl,
  SwitchControl,
  TextAreaControl,
} from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";

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
      <SettingsSectionBlock
        title="Dictation"
        description="Hold a key, speak, and let go: your words are typed wherever you're typing, in Misty or any other app."
      >
        <SettingsRow
          label="Dictation"
          description="The microphone opens only while you hold the shortcut or lock it hands-free."
        >
          <SwitchControl
            checked={voice.dictation}
            disabled={props.working}
            onChange={(value) => set("dictation_enabled", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Dictation shortcut"
          description="Hold to talk, release to type. Control + Option stays the agent at your cursor."
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
          description="Double-tap the shortcut to keep listening until you tap it again."
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
          description="Fixes punctuation and drops filler words before typing, in the style you pick. Uses your AI allowance."
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
          description={
            'Starting with "Hey" and an agent\'s name sends the rest to that agent instead of typing it.'
          }
          muted={!voice.dictation}
        >
          <SwitchControl
            checked={voice.agentHandoff}
            disabled={dictationOff}
            onChange={(value) => set("agent_handoff", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
      <SettingsSectionBlock
        title="Speech"
        description="Applies to dictation and captures. Speech is transcribed in the cloud on Misty's service."
      >
        <SettingsRow
          label="Language"
          description="Detect automatically, or pin the language you speak for better accuracy."
        >
          <DropdownControl
            value={voice.language}
            options={languages}
            disabled={props.working}
            onValueChange={(value) => set("language", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Personal dictionary"
          description="Names and terms to spell your way, one per line. They're sent with your speech as context."
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
      <SettingsSectionBlock
        title="Captures"
        description="Turning speech you hear into notes: a tab, system audio, the microphone or a file."
      >
        <SettingsRow
          label="Default sources"
          description="Which audio a new capture starts with. You can change it each time."
        >
          <DropdownControl
            value={voice.captureSources}
            options={sources}
            disabled={props.working}
            onValueChange={(value) => set("capture_sources", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Keep recordings"
          description="Keep the audio with the transcript. Recordings count toward your storage; otherwise only the text is kept."
        >
          <SwitchControl
            checked={voice.keepRecordings}
            disabled={props.working}
            onChange={(value) => set("keep_recordings", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
    </>
  );
}
