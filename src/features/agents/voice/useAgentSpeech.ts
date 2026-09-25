import { useCallback, useEffect, useRef, useState } from "react";
import { agentsApi } from "@/api/agents/api";

export function useAgentSpeech(scope: string) {
  const [phase, setPhase] = useState<"idle" | "loading" | "speaking">("idle");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const playing = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    if (playing.current) {
      playing.current.onended = null;
      playing.current.onerror = null;
      playing.current.pause();
      playing.current.removeAttribute("src");
    }
    playing.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPhase("idle");
  }, []);
  useEffect(() => {
    stop();
    setError("");
    return stop;
  }, [scope, stop]);
  const speak = useCallback(
    async (invocationId: string) => {
      stop();
      const epoch = generation.current;
      const controller = new AbortController();
      request.current = controller;
      setError("");
      setPhase("loading");
      try {
        const blob = await agentsApi.speech(invocationId, controller.signal);
        if (epoch !== generation.current) return;
        url.current = URL.createObjectURL(blob);
        const audio = new Audio(url.current);
        playing.current = audio;
        audio.onended = () => {
          if (epoch === generation.current) stop();
        };
        audio.onerror = () => {
          if (epoch === generation.current) {
            stop();
            setError("Audio could not play. Your answer is still in the conversation.");
          }
        };
        await audio.play();
        if (epoch === generation.current) setPhase("speaking");
      } catch (reason) {
        if (epoch !== generation.current) return;
        stop();
        setError(
          reason instanceof Error
            ? reason.message
            : "Speech is unavailable. You can still read the answer.",
        );
      }
    },
    [stop],
  );
  return { phase, error, speak, stop };
}
