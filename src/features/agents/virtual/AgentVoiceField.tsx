import { useSpeechSupport } from "@/features/voice";
import type { AgentProfile } from "@/shared/schemas";
import {
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/shared/ui";
import { pickVoice, useStudioVoices, voiceOf } from "./studioVoices";

/**
 * The voice an agent answers in when it is talked to aloud in the studio: one of this computer's
 * own voices. Until one is picked it has its own, chosen from its id. The change saves itself.
 * Shown only where the computer has voices to choose from.
 */
export function AgentVoiceField({ agent }: { agent: AgentProfile }) {
  const speech = useSpeechSupport();
  const picked = useStudioVoices((state) => state.value);
  if (speech && !speech.voices.length) return null;
  const current = speech ? voiceOf(agent.id, speech.voices, picked) : undefined;
  return (
    <Field label="Voice">
      {speech ? (
        <Select value={current?.id ?? ""} onValueChange={(id) => pickVoice(agent.id, id)}>
          <SelectTrigger aria-label={`${agent.name}'s voice`} className="w-full">
            <SelectValue placeholder="Pick a voice" />
          </SelectTrigger>
          <SelectContent>
            {speech.voices.map((voice) => (
              <SelectItem
                key={voice.id}
                value={voice.id}
                label={`${voice.name} (${voice.language})`}
              />
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Skeleton className="h-8 w-full" />
      )}
    </Field>
  );
}
