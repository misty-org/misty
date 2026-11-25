import { Volume2 } from "lucide-react";
import { Button, IconButton, ListRow, ListRowSkeleton, notify, Text } from "@misty/ui";
import {
  previewVoice,
  useVoicebox,
  useVoiceboxVoices,
  VOICEBOX_APP_ID,
  type VoiceboxVoice,
} from "@/features/voice";
import { requestOpenExplore } from "@/shared/lib/open_explore";

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" });
  } catch {
    return undefined;
  }
})();

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function voiceLine(voice: VoiceboxVoice) {
  const language = voice.language ? (languageNames?.of(voice.language) ?? voice.language) : "";
  return [voice.gender ? capital(voice.gender) : "", language].filter(Boolean).join(", ");
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
  const voicebox = useVoicebox();
  const ready = Boolean(voicebox?.installed);
  const { voices, error, retry } = useVoiceboxVoices(ready);
  const sample = `Hi, I'm ${name.trim() || "your agent"}. This is how I sound.`;
  const hear = (item: VoiceboxVoice) =>
    void previewVoice(item.key, sample).catch((reason: unknown) =>
      notify({ message: String(reason), tone: "error" }),
    );

  if (!voicebox) return <ListRowSkeleton label="Voices" rows={4} lines={2} />;
  if (!voicebox.runsHere) return null;
  if (!ready)
    return (
      <div className="grid justify-items-start gap-2">
        <Text size="meta" tone="muted" wrap>
          Agents speak through Voicebox.
        </Text>
        <Button onClick={() => requestOpenExplore("apps", VOICEBOX_APP_ID)}>Get Voicebox</Button>
      </div>
    );
  if (error)
    return (
      <div className="grid justify-items-start gap-2">
        <Text size="meta" tone="danger" wrap>
          {error}
        </Text>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  if (!voices) return <ListRowSkeleton label="Voices" rows={4} lines={2} />;
  return (
    <div id={id} role="group" aria-label="Voice" className="grid max-h-64 overflow-y-auto">
      {voices.map((item) => (
        <ListRow
          key={item.key}
          label={item.name}
          description={voiceLine(item)}
          checked={item.key === voice}
          disabled={disabled}
          onOpen={() => onChange(item.key)}
          trailing={
            <IconButton label={`Hear ${item.name}`} disabled={disabled} onClick={() => hear(item)}>
              <Volume2 />
            </IconButton>
          }
        />
      ))}
    </div>
  );
}
