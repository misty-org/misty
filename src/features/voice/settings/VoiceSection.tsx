import {
  AudioLines,
  Download,
  Keyboard,
  Languages,
  Mic,
  MonitorSpeaker,
  Volume2,
} from "lucide-react";
import { Button, IconButton, notify } from "@misty/ui";
import { invoke } from "@/native/invoke";
import { say, useSpeechSupport } from "../systemSpeech";
import { hasNaturalVoice, voicesFor } from "./voiceChoices";
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
const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.platform);
/** What a voice says when it's tried out. */
const preview = "Hi, I'm Misty. This is how I sound.";
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
  { value: "auto", label: "System language", icon: Languages },
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

const rates = [
  { value: "0.75", label: "Slower" },
  { value: "1", label: "Normal" },
  { value: "1.25", label: "Faster" },
  { value: "1.5", label: "Fastest" },
];

/**
 * Settings › Voice: dictation everywhere, voice captures, and the computer's own voice that
 * speaks for Misty (Tutor, read aloud, audio overviews). Speech is recognized and spoken on this
 * computer, with no key. Device-only.
 */
export function VoiceSection(props: SettingsContentProps) {
  const voice = voiceSettings(props.document);
  const speech = useSpeechSupport();
  // The voices for the language Misty speaks in, Premium and Enhanced first; empty is the
  // system's default.
  const offered = voicesFor(
    speech?.voices ?? [],
    voice.language,
    voice.systemVoice,
    navigator.language,
  );
  const voices = [
    { value: "", label: "System default" },
    ...offered.map((item) => ({
      value: item.id,
      label: `${item.name} (${item.language})`,
    })),
  ];
  const chosenVoice = voices.some((item) => item.value === voice.systemVoice)
    ? voice.systemVoice
    : "";
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
          description="Fixes punctuation and drops filler words before typing, in the style you pick. Runs on your default engine."
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
            placeholder={"Misty\nAntigravity"}
            rows={4}
            disabled={props.working}
            onCommit={(value) => set("dictionary", value)}
          />
        </SettingsRow>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="Speaking">
        <SettingsRow label="Voice">
          <DropdownControl
            value={chosenVoice}
            options={voices}
            disabled={props.working || !speech}
            onValueChange={(value) => set("system_voice", value)}
          />
          <IconButton
            label="Hear this voice"
            disabled={!speech}
            onClick={() =>
              void say(preview, chosenVoice).catch((reason: unknown) =>
                notify({ message: String(reason), tone: "error" }),
              )
            }
          >
            <Volume2 />
          </IconButton>
        </SettingsRow>
        {speech && (isMac ? !hasNaturalVoice(offered) : isWindows) && (
          <SettingsRow
            label="More natural voices"
            description={
              isMac
                ? "Premium and Enhanced voices download free in System Settings › Accessibility › Spoken Content."
                : "More voices download free in Windows Settings › Time & language › Speech."
            }
          >
            <Button
              icon={Download}
              onClick={() =>
                void invoke("speech_open_voice_settings").catch((reason: unknown) =>
                  notify({ message: String(reason), tone: "error" }),
                )
              }
            >
              Get voices
            </Button>
          </SettingsRow>
        )}
        <SettingsRow label="Speaking rate">
          <ChoiceControl
            value={String(voice.speakingRate)}
            options={rates}
            disabled={props.working}
            onValueChange={(value) => set("speaking_rate", value)}
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
