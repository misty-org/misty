import { listen as listenEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { voiceSettings } from "./voice_settings";

export interface SpeechSupport {
  recognition: boolean;
  speaking: boolean;
}

const none: SpeechSupport = { recognition: false, speaking: false };

export function speechSupport(): Promise<SpeechSupport> {
  return invoke<SpeechSupport>("speech_support").catch(() => none);
}

export function useSpeechSupport(): SpeechSupport | null {
  const [support, setSupport] = useState<SpeechSupport | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () => void speechSupport().then((found) => live && setSupport(found));
    ask();
    window.addEventListener(SPEECH_CHANGED, ask);
    const unlisten = hasTauriInternals()
      ? ["misty://apps-changed", "misty://app-server-install"].map((name) =>
          listenEvent(name, ask).catch(() => null),
        )
      : [];
    return () => {
      live = false;
      window.removeEventListener(SPEECH_CHANGED, ask);
      for (const pending of unlisten) void pending.then((stop) => stop?.());
    };
  }, []);
  return support;
}

export const SPEECH_CHANGED = "misty:speech-changed";

const regions: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-BR",
  nl: "nl-NL",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
  hi: "hi-IN",
  ru: "ru-RU",
};

function chosen() {
  return voiceSettings(useSettingsStore.getState().settings?.document);
}

export function recognitionLanguage(): string | undefined {
  const language = chosen().language;
  return language === "auto" ? undefined : (regions[language] ?? language);
}

export function recognitionLanguages(): (string | undefined)[] {
  const first = recognitionLanguage();
  const second = chosen().secondLanguage;
  const extra = second === "none" ? undefined : (regions[second] ?? second);
  return extra && extra !== first ? [first, extra] : [first];
}

export function recognizeFile(path: string): Promise<string> {
  return invoke<string>("speech_recognize_file", { path });
}

async function base64Of(audio: Blob): Promise<string> {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

export async function recognizeAudio(audio: Blob): Promise<string> {
  return invoke<string>("speech_recognize_audio", {
    audio: await base64Of(audio),
    mime: audio.type,
  });
}

export interface HeardWord {
  text: string;
  start: number;
  end: number;
}

export async function recognizeAudioWords(audio: Blob): Promise<HeardWord[]> {
  return invoke<HeardWord[]>("speech_recognize_audio_words", {
    audio: await base64Of(audio),
    mime: audio.type,
  });
}

export type HearingEvent =
  | { kind: "started"; input: string }
  | { kind: "stopped"; input: string }
  | { kind: "heard"; input: string; text: string; start: number; end: number; words: HeardWord[] }
  | { kind: "failed"; error: string };

interface SpeechPayload {
  session: number;
  input?: string;
  kind: "started" | "stopped" | "heard" | "failed" | "closed";
  text?: string;
  start?: number;
  end?: number;
  words?: HeardWord[];
  error?: string;
}

export interface HearingSession {
  mic(input: string): Promise<void>;
  push(input: string, pcm: string): void;
  reset(input: string): void;
  remove(input: string): void;
  stop(): Promise<void>;
}

export async function hear(onEvent: (event: HearingEvent) => void): Promise<HearingSession> {
  let session = 0;
  let closed: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const early: SpeechPayload[] = [];
  const handle = (payload: SpeechPayload) => {
    if (payload.kind === "closed") {
      closed();
      return;
    }
    if (payload.kind === "failed") {
      onEvent({ kind: "failed", error: payload.error ?? "" });
      return;
    }
    const input = payload.input ?? "";
    if (payload.kind === "heard")
      onEvent({
        kind: "heard",
        input,
        text: payload.text ?? "",
        start: payload.start ?? 0,
        end: payload.end ?? 0,
        words: payload.words ?? [],
      });
    else onEvent({ kind: payload.kind, input });
  };
  const unlisten: UnlistenFn = await listenEvent<SpeechPayload>("misty://speech", (event) => {
    if (!session) return void early.push(event.payload);
    if (event.payload.session === session) handle(event.payload);
  });
  try {
    session = await invoke<number>("speech_hear_start");
  } catch (error) {
    unlisten();
    throw error;
  }
  for (const payload of early) if (payload.session === session) handle(payload);
  let stopping: Promise<void> | null = null;
  let pushing: Promise<unknown> = Promise.resolve();
  let pushFailed = false;
  const stop = () => {
    stopping ??= (async () => {
      window.removeEventListener("pagehide", stop);
      try {
        await pushing.catch(() => undefined);
        await invoke("speech_hear_stop", { session });
        await done;
      } finally {
        unlisten();
      }
    })();
    return stopping;
  };
  window.addEventListener("pagehide", stop);
  return {
    mic: (input) => invoke<void>("speech_hear_mic", { session, input }),
    push(input, pcm) {
      if (stopping) return;
      pushing = pushing
        .then(() => invoke("speech_hear_push", { session, input, pcm }))
        .catch((error: unknown) => {
          if (pushFailed || stopping) return;
          pushFailed = true;
          onEvent({ kind: "failed", error: typeof error === "string" ? error : "" });
        });
    },
    reset: (input) => void invoke("speech_hear_reset", { session, input }).catch(() => undefined),
    remove: (input) => void invoke("speech_hear_remove", { session, input }).catch(() => undefined),
    stop,
  };
}

export interface Listening {
  stop(): Promise<string>;
}

export async function listen(
  onHeard: (heard: { text: string; final: boolean; error?: string }) => void,
): Promise<Listening> {
  const said: string[] = [];
  const text = () => said.join(" ").trim();
  const session = await hear((event) => {
    if (event.kind === "heard" && event.text.trim()) {
      said.push(event.text.trim());
      onHeard({ text: text(), final: false });
    } else if (event.kind === "failed") {
      onHeard({ text: text(), final: false, error: event.error });
    }
  });
  try {
    await session.mic("mic");
  } catch (error) {
    await session.stop().catch(() => undefined);
    throw error;
  }
  return {
    async stop() {
      await session.stop();
      onHeard({ text: text(), final: true });
      return text();
    },
  };
}

export function say(text: string, voice?: string): Promise<void> {
  return invoke<void>("speech_say", {
    text,
    voice: voice || undefined,
    rate: chosen().speakingRate,
  });
}

export function previewVoice(voice: string, text: string): Promise<void> {
  return invoke<void>("speech_preview", { voice, text });
}

export interface RenderedSpeech {
  pcm: string;
  rate: number;
}

export function renderSpeech(text: string, voice?: string): Promise<RenderedSpeech> {
  return invoke<RenderedSpeech>("speech_render", {
    text,
    voice: voice || undefined,
    rate: chosen().speakingRate,
  });
}

export interface Reading {
  add(sentence: string): void;
  started(): number;
  onBegin(listener: (begun: number) => void): () => void;
  end(): Promise<void>;
}

export function openReading(voice?: string): Reading {
  let begun = 0;
  let over = false;
  const listeners = new Set<(begun: number) => void>();
  const tell = () => {
    for (const listener of listeners) listener(over ? Number.MAX_SAFE_INTEGER : begun);
  };
  let reading = 0;
  const early: { reading: number; index?: number; done?: boolean }[] = [];
  const apply = (payload: { reading: number; index?: number; done?: boolean }) => {
    if (payload.done) over = true;
    else if (typeof payload.index === "number") begun = Math.max(begun, payload.index + 1);
    tell();
  };
  const unlistening = listenEvent<{ reading: number; index?: number; done?: boolean }>(
    "misty://speech-said",
    (event) => {
      if (!reading) return void early.push(event.payload);
      if (event.payload.reading === reading) apply(event.payload);
    },
  );
  const opened = unlistening.then(() =>
    invoke<number>("speech_reading_start", {
      voice: voice || undefined,
      rate: chosen().speakingRate,
    }).then((id) => {
      reading = id;
      for (const payload of early) if (payload.reading === id) apply(payload);
      return id;
    }),
  );
  const stopListening = () =>
    void unlistening.then((unlisten) => unlisten()).catch(() => undefined);
  opened.catch(() => {
    over = true;
    tell();
    stopListening();
  });
  let sent: Promise<unknown> = opened;
  return {
    add(sentence) {
      if (!sentence.trim()) return;
      sent = sent
        .then(() => opened)
        .then((id) => invoke("speech_reading_add", { reading: id, text: sentence }))
        .catch(() => undefined);
    },
    started: () => (over ? Number.MAX_SAFE_INTEGER : begun),
    onBegin(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async end() {
      await sent.catch(() => undefined);
      try {
        const id = await opened;
        await invoke("speech_reading_end", { reading: id });
      } catch {
      } finally {
        over = true;
        tell();
        stopListening();
      }
    },
  };
}

export const outputMuted = () => invoke<boolean>("speech_output_muted").catch(() => false);

export const onCall = () => invoke<boolean>("speech_on_call").catch(() => false);

export const soundOn = () => invoke<void>("speech_sound_on");

export const copyAnswer = (text: string) => invoke<void>("speech_copy_answer", { text });

export function stopSaying(): Promise<void> {
  return invoke<void>("speech_stop").catch(() => undefined);
}

export function chosenVoice(): string | undefined {
  return chosen().voice || undefined;
}
