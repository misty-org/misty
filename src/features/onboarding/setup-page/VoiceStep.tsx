import { Volume2 } from "lucide-react";
import { useEffect } from "react";
import {
  ErrorState,
  Field,
  IconButton,
  ListCard,
  ListRow,
  notify,
  OptionSelect,
  SkeletonList,
} from "@misty/ui";
import {
  personLanguages,
  previewVoice,
  speechLanguages,
  useSpeechModels,
  voiceLabel,
  voiceSample,
  voicesFor,
  type VoiceView,
} from "@/features/voice";

export function VoiceStep(props: {
  language: string;
  voice: string;
  onLanguage(language: string): void;
  onVoice(voice: string): void;
}) {
  const catalog = useSpeechModels((state) => state.catalog);
  const error = useSpeechModels((state) => state.error);
  useEffect(() => {
    void useSpeechModels.getState().load();
  }, []);
  const voices = catalog ? voicesFor(catalog.voices, personLanguages(props.language)) : [];
  return (
    <>
      <Field label="Language" layout="inline">
        <OptionSelect
          className="w-50"
          value={props.language}
          options={speechLanguages}
          onValueChange={props.onLanguage}
        />
      </Field>
      {catalog ? (
        <ListCard aria-label="Voices">
          {voices.map((voice) => (
            <li key={voice.id}>
              <VoiceRow
                voice={voice}
                chosen={voice.id === props.voice}
                onChoose={() => props.onVoice(voice.id)}
              />
            </li>
          ))}
        </ListCard>
      ) : error ? (
        <ErrorState
          inline
          title="Voices couldn't load"
          line={error}
          action={{
            label: "Try again",
            variant: "secondary",
            onClick: () => void useSpeechModels.getState().load(),
          }}
        />
      ) : (
        <SkeletonList label="Voices" variant="card" rows={4} trailing="icon" />
      )}
    </>
  );
}

function VoiceRow(props: { voice: VoiceView; chosen: boolean; onChoose(): void }) {
  const label = voiceLabel(props.voice);
  return (
    <ListRow
      label={label}
      checked={props.chosen}
      onOpen={props.onChoose}
      trailing={
        props.voice.installed ? (
          <IconButton
            label={`Hear ${props.voice.name}`}
            onClick={() =>
              void previewVoice(props.voice.id, voiceSample).catch((reason: unknown) =>
                notify({ message: String(reason), tone: "error" }),
              )
            }
          >
            <Volume2 />
          </IconButton>
        ) : null
      }
    />
  );
}
