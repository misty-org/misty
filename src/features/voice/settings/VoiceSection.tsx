import {
  AudioLines,
  Keyboard,
  Mic,
  MonitorSpeaker,
  MoreHorizontal,
  Trash2,
  Volume2,
} from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  notify,
  useConfirmDelete,
} from "@misty/ui";
import { useEffect } from "react";
import { previewVoice } from "../speech";
import {
  chooseHearing,
  chooseMistyVoice,
  ensureSpeech,
  personLanguages,
  rankHearing,
  useSpeechModels,
  voicesFor,
  type HearingModelView,
  type InstallProgress,
  type VoiceView,
} from "../speechModels";
import { voiceSettings } from "../voiceSettings";
import { speechLanguages, voiceLabel, voiceSample } from "./speechChoices";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsRowSkeleton,
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
// Text alone: every row would repeat the same icon.
const secondLanguages = [
  { value: "none", label: "None" },
  ...speechLanguages
    .filter((language) => language.value !== "auto")
    .map(({ value, label }) => ({ value, label })),
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

const megabytes = (entry: { disk_mb: number }) =>
  entry.disk_mb >= 1000 ? `${(entry.disk_mb / 1000).toFixed(1)} GB` : `${entry.disk_mb} MB`;

/** Where a model or voice is when it isn't on this computer yet, for its row's line. */
function arrivalLine(
  entry: { id: string; installed: boolean } | undefined,
  progress: Record<string, InstallProgress>,
  installing: readonly string[],
  failures: Record<string, string>,
): string | undefined {
  if (!entry || entry.installed) return undefined;
  const install = progress[entry.id];
  if (install?.phase === "unpacking") return "Unpacking on this computer.";
  if (install || installing.includes(entry.id))
    return install?.total
      ? `Downloading, ${Math.round((install.received / install.total) * 100)}%.`
      : "Downloading.";
  if (failures[entry.id]) return `Couldn't download: ${failures[entry.id]}`;
  return "Not on this computer yet.";
}

/**
 * Settings › Voice: dictation everywhere, voice captures, and speech on this computer through open
 * models from Misty's catalog: the speech model Misty picked for hearing (with Change), Misty's
 * own voice (Tutor, read-alouds outside an agent), and the models and voices on this computer
 * that aren't in use, each with Remove. Speech is recognized and spoken on this computer, with no
 * key. Device-only.
 */
export function VoiceSection(props: SettingsContentProps) {
  const voice = voiceSettings(props.document);
  const catalog = useSpeechModels((state) => state.catalog);
  const loadError = useSpeechModels((state) => state.error);
  const progress = useSpeechModels((state) => state.progress);
  const failures = useSpeechModels((state) => state.failures);
  const { confirm, dialog } = useConfirmDelete();
  useEffect(() => {
    void useSpeechModels.getState().load();
  }, []);
  // Read here so a change of language on this page offers that language's models and voices.
  const languages = catalog ? personLanguages() : [];
  const hearing = catalog?.hearing.find((model) => model.id === voice.hearingModel);
  const ranked = catalog ? rankHearing(catalog.hearing, languages, catalog.machine) : [];
  const hearingChoices: HearingModelView[] =
    hearing && !ranked.some((model) => model.id === hearing.id) ? [hearing, ...ranked] : ranked;
  const mistyVoice = catalog?.voices.find((entry) => entry.id === voice.voice);
  const offeredVoices = catalog ? voicesFor(catalog.voices, languages) : [];
  const voiceChoices =
    mistyVoice && !offeredVoices.some((entry) => entry.id === mistyVoice.id)
      ? [mistyVoice, ...offeredVoices]
      : offeredVoices;
  // What's on this computer but not in use, one row per download: voices that share one model
  // go together, and one that shares Misty's voice's download is in use.
  const inUse = new Set([hearing?.packageKey, mistyVoice?.packageKey].filter(Boolean));
  const spare = new Map<string, (HearingModelView | VoiceView)[]>();
  for (const entry of [...(catalog?.hearing ?? []), ...(catalog?.voices ?? [])]) {
    if (!entry.installed || inUse.has(entry.packageKey)) continue;
    spare.set(entry.packageKey, [...(spare.get(entry.packageKey) ?? []), entry]);
  }
  const installing = catalog?.installing ?? [];
  // A model under CC-BY carries its credit wherever it's named.
  const hearingLine = [arrivalLine(hearing, progress, installing, failures), hearing?.credit]
    .filter(Boolean)
    .join(" ");
  const voiceLine = arrivalLine(mistyVoice, progress, installing, failures);
  const failed = (entry: { id: string } | undefined) =>
    Boolean(entry && failures[entry.id] && !progress[entry.id]);
  const remove = (entries: (HearingModelView | VoiceView)[]) => {
    const name = entries.map((entry) => entry.name).join(", ");
    void confirm({
      title: `Remove ${name}?`,
      what: "It's deleted from this computer. You can download it again later.",
      confirmLabel: "Remove",
      onConfirm: () => useSpeechModels.getState().remove(entries[0]!.id),
    });
  };
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
            options={speechLanguages}
            disabled={props.working}
            onValueChange={(value) => set("language", value)}
          />
        </SettingsRow>
        <SettingsRow
          label="Second language"
          description="Tutor also listens for this one and answers in whichever you speak."
        >
          <DropdownControl
            value={voice.secondLanguage}
            options={secondLanguages}
            disabled={props.working}
            onValueChange={(value) => set("second_language", value)}
          />
        </SettingsRow>
        {catalog ? (
          <SettingsRow label="Speech model" description={hearingLine || undefined}>
            {failed(hearing) ? (
              <Button onClick={() => void ensureSpeech()}>Try again</Button>
            ) : null}
            <DropdownControl
              value={hearing?.id ?? ""}
              options={hearingChoices.map((model) => ({ value: model.id, label: model.name }))}
              disabled={props.working || !hearingChoices.length}
              onValueChange={(value) => {
                chooseHearing(value);
                void ensureSpeech();
              }}
            />
          </SettingsRow>
        ) : loadError ? (
          <SettingsRow label="Speech model" description={loadError}>
            <Button onClick={() => void useSpeechModels.getState().load()}>Try again</Button>
          </SettingsRow>
        ) : (
          <DesktopSettingsRowSkeleton
            label="Speech model"
            control={{ kind: "select", className: "w-50" }}
          />
        )}
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
        {catalog ? (
          <SettingsRow label="Voice" description={voiceLine}>
            {failed(mistyVoice) ? (
              <Button onClick={() => void ensureSpeech()}>Try again</Button>
            ) : null}
            <DropdownControl
              value={mistyVoice?.id ?? ""}
              options={voiceChoices.map((entry) => ({ value: entry.id, label: voiceLabel(entry) }))}
              disabled={props.working || !voiceChoices.length}
              onValueChange={(value) => {
                chooseMistyVoice(value);
                void ensureSpeech();
              }}
            />
            <IconButton
              label="Hear this voice"
              disabled={!mistyVoice}
              onClick={() =>
                mistyVoice &&
                void previewVoice(mistyVoice.id, voiceSample).catch((reason: unknown) =>
                  notify({ message: String(reason), tone: "error" }),
                )
              }
            >
              <Volume2 />
            </IconButton>
          </SettingsRow>
        ) : loadError ? null : (
          <DesktopSettingsRowSkeleton
            label="Voice"
            control={[{ kind: "select", className: "w-50" }, "icon"]}
          />
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
      {spare.size ? (
        <SettingsSectionBlock title="On this computer">
          {[...spare.entries()].map(([key, entries]) => (
            <SettingsRow
              key={key}
              label={entries.map((entry) => entry.name).join(", ")}
              description={megabytes(entries[0]!)}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`Actions for ${entries[0]!.name}`} variant="quiet">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <MenuItem icon={Trash2} label="Remove" danger onSelect={() => remove(entries)} />
                </DropdownMenuContent>
              </DropdownMenu>
            </SettingsRow>
          ))}
        </SettingsSectionBlock>
      ) : null}
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
      {dialog}
    </>
  );
}
