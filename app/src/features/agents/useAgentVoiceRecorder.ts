import { agentsApi } from "@/api/agents/api";
import { useEffect, useRef, useState } from "react";

export function useAgentVoiceRecorder({
  onTranscript,
  onError,
}: {
  onTranscript: (transcript: string) => void;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    },
    [],
  );

  const start = async () => {
    if (recording || transcribing) return;
    onError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("Voice recording is not available on this device.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const duration = Math.min(60_000, Date.now() - startedAtRef.current);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0) return void onError("No audio was recorded.");
        setTranscribing(true);
        void agentsApi
          .transcribeVoice(blob, duration)
          .then((result) => onTranscript(result.transcript))
          .catch((reason) =>
            onError(reason instanceof Error ? reason.message : "Voice could not be transcribed."),
          )
          .finally(() => setTranscribing(false));
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      timeoutRef.current = window.setTimeout(() => recorder.stop(), 60_000);
    } catch {
      onError("Microphone access was not granted.");
    }
  };

  const stop = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  return { recording, transcribing, start, stop };
}
