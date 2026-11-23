import { useEffect, useImperativeHandle, type Ref } from "react";
import { useAiVoiceRecorder } from "../../runs/markdown/use_ai_voice_recorder";

export type AgentVoiceControl = { toggle(): void };

export function useConversationVoice({
  contextKey,
  available,
  onTranscript,
  onError,
  controlRef,
  onStateChange,
}: {
  contextKey: string;
  available: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  controlRef?: Ref<AgentVoiceControl>;
  onStateChange?(state: { recording: boolean; busy: boolean }): void;
}) {
  const voice = useAiVoiceRecorder({ contextKey, onTranscript, onError });
  useImperativeHandle(controlRef, () => ({
    toggle() {
      if (!available || voice.requesting || voice.transcribing) return;
      if (voice.recording) voice.stop();
      else void voice.start();
    },
  }));
  useEffect(() => {
    onStateChange?.({
      recording: voice.recording,
      busy: voice.requesting || voice.transcribing,
    });
  }, [voice.recording, voice.requesting, voice.transcribing, onStateChange]);
  return voice;
}
