import { listen as listenEvent } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { SPEECH_CHANGED } from "./speech";

export const VOICEBOX_APP_ID = "voicebox";

export interface VoiceboxState {
  runsHere: boolean;
  installed: boolean;
}

export interface VoiceboxVoice {
  key: string;
  name: string;
  gender: string;
  language: string;
}

export interface VoiceboxProgress {
  received: number;
  total: number;
}

const notHere: VoiceboxState = { runsHere: false, installed: false };
const CHANGES = ["misty://apps-changed", "misty://app-server-install"] as const;

export function voiceboxState(): Promise<VoiceboxState> {
  if (!hasTauriInternals()) return Promise.resolve(notHere);
  return invoke<VoiceboxState>("voicebox_state").catch(() => notHere);
}

export function useVoicebox(): VoiceboxState | null {
  const [state, setState] = useState<VoiceboxState | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () => void voiceboxState().then((found) => live && setState(found));
    ask();
    window.addEventListener(SPEECH_CHANGED, ask);
    const unlisten = hasTauriInternals() ? CHANGES.map((name) => listenEvent(name, ask)) : [];
    return () => {
      live = false;
      window.removeEventListener(SPEECH_CHANGED, ask);
      for (const pending of unlisten) void pending.then((stop) => stop());
    };
  }, []);
  return state;
}

let cachedVoices: Promise<VoiceboxVoice[]> | null = null;

export function voiceboxVoices(): Promise<VoiceboxVoice[]> {
  cachedVoices ??= invoke<VoiceboxVoice[]>("voicebox_voices").catch((error: unknown) => {
    cachedVoices = null;
    throw error;
  });
  return cachedVoices;
}

export function useVoiceboxVoices(ready: boolean) {
  const [voices, setVoices] = useState<VoiceboxVoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setError(null);
    voiceboxVoices()
      .then((found) => live && setVoices(found))
      .catch((reason: unknown) => {
        if (!live) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      live = false;
    };
  }, [ready, attempt]);
  return { voices, error, retry: () => setAttempt((count) => count + 1) };
}

export function warmVoicebox(): Promise<void> {
  if (!hasTauriInternals()) return Promise.resolve();
  return invoke<void>("voicebox_warm");
}

export function useVoiceboxProgress(): VoiceboxProgress | null {
  const [progress, setProgress] = useState<VoiceboxProgress | null>(null);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    const stop = listenEvent<{ appId: string; received: number; total: number }>(
      "misty://app-server-install",
      ({ payload }) => {
        if (payload.appId !== VOICEBOX_APP_ID) return;
        setProgress(
          payload.received >= payload.total
            ? null
            : { received: payload.received, total: payload.total },
        );
      },
    );
    return () => void stop.then((unlisten) => unlisten());
  }, []);
  return progress;
}
