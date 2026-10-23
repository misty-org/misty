import { useEffect, useImperativeHandle, type Ref } from "react";
import { useAiVoiceRecorder } from "@/features/ai-surface/useAiVoiceRecorder";

export type AgentVoiceControl = { toggle(): void };

/**
 * Voice input for the conversation's composer: the recorder, the toggle the page's shortcut
 * calls, and the recording state reported up to the page.
 */
export function useConversationVoice({
  contextKey,
  available,
  onTranscript,
  onError,
  controlRef,
  onStateChange,
}: {
  contextKey: string;
  /** The agent is enabled, someone is signed in and no task is running. */
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
