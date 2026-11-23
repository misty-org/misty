import { useEffect, useMemo } from "react";
import { Volume2 } from "lucide-react";
import { IconButton, ListRow, ListRowSkeleton, notify, SetupState, Text } from "@misty/ui";
import {
  personLanguages,
  previewVoice,
  useSpeechModels,
  voicesFor,
  type VoiceView,
} from "@/features/voice";
import { voiceProgress, voiceSetupLine } from "./agent_voice";

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" });
  } catch {
    return undefined;
  }
})();

export function voiceLine(voice: VoiceView) {
  const languages = voice.languages
    .filter((code) => code !== "*")
    .map((code) => languageNames?.of(code) ?? code);
  return [...languages, ...(voice.accent ? [voice.accent] : [])].join(", ");
}

export function AgentVoicePicker({
  id,
  name,
  voice,
  disabled,
  onChange,
}: {
  id?: string;
  name: string;
  voice: string | undefined;
  disabled?: boolean;
  onChange(voice: string): void;
}) {
  const catalog = useSpeechModels((state) => state.catalog);
  const loadError = useSpeechModels((state) => state.error);
  const progress = useSpeechModels((state) => state.progress);
  const failures = useSpeechModels((state) => state.failures);
  useEffect(() => {
    if (!useSpeechModels.getState().catalog) void useSpeechModels.getState().load();
  }, []);
  const voices = useMemo(
    () => (catalog ? voicesFor(catalog.voices, personLanguages()) : []),
    [catalog],
  );
  const picked = catalog?.voices.find((item) => item.id === voice);
  const downloading = (item: VoiceView) =>
    Boolean(voiceProgress(progress, item)) ||
    Boolean(catalog?.installing.some((id) => id === item.id || id === item.packageKey));
  const pick = (item: VoiceView) => {
    onChange(item.id);
    if (!item.installed && !downloading(item)) void useSpeechModels.getState().install(item.id);
  };
  const sample = `Hi, I'm ${name.trim() || "your agent"}. This is how I sound.`;
  const hear = (item: VoiceView) =>
    void previewVoice(item.id, sample).catch((reason: unknown) =>
      notify({ message: String(reason), tone: "error" }),
    );
  const failure = picked ? failures[picked.id] : undefined;
  const coming = picked && !picked.installed ? voiceProgress(progress, picked) : undefined;

  if (!catalog && loadError)
    return (
      <Text size="meta" tone="danger" wrap>
        {loadError}
      </Text>
    );
  if (!catalog) return <ListRowSkeleton label="Voices" rows={4} lines={2} />;
  return (
    <div className="grid gap-2">
      <div id={id} role="group" aria-label="Voice" className="grid max-h-64 overflow-y-auto">
        {voices.map((item) => (
          <ListRow
            key={item.id}
            label={item.name}
            description={voiceLine(item)}
            checked={item.id === voice}
            disabled={disabled}
            state={!item.installed && downloading(item) ? { kind: "downloading" } : undefined}
            onOpen={() => pick(item)}
            trailing={
              item.installed ? (
                <IconButton
                  label={`Hear ${item.name}`}
                  disabled={disabled}
                  onClick={() => hear(item)}
                >
                  <Volume2 />
                </IconButton>
              ) : null
            }
          />
        ))}
      </div>
      {picked && !picked.installed ? (
        <SetupState
          tool="voice"
          label={
            coming?.total
              ? `${voiceSetupLine(name)}, ${Math.round((coming.received / coming.total) * 100)}%`
              : voiceSetupLine(name)
          }
          size="row"
          stallAfterMs={false}
          error={failure}
          onRetry={() => void useSpeechModels.getState().install(picked.id)}
        />
      ) : null}
    </div>
  );
}
