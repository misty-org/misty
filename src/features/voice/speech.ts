import { listen as listenEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings";
import { invoke } from "@/native/invoke";
import { voiceSettings } from "./voiceSettings";

/**
 * Speech on this computer through open models from Misty's catalog (`speechModels.ts` picks
 * them), with no key: hearing what the person says and speaking in a voice. Native code runs the
 * models (`src-tauri/features/voice/speech.rs`) and pushes what happens as events; nothing here
 * polls. The chat microphone, dictation, recordings, captions, Tutor and agents in calls all go
 * through here.
 */

export interface SpeechSupport {
  /** The hearing model in use is on this computer: microphones show only then. */
  recognition: boolean;
  /** Misty's voice is on this computer. */
  speaking: boolean;
}

const none: SpeechSupport = { recognition: false, speaking: false };

/** What this computer can do with speech now. Asked afresh: a model may have just arrived. */
export function speechSupport(): Promise<SpeechSupport> {
  return invoke<SpeechSupport>("speech_support").catch(() => none);
}

/** Speech support for a component, asked again whenever the models change; null until known. */
export function useSpeechSupport(): SpeechSupport | null {
  const [support, setSupport] = useState<SpeechSupport | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () => void speechSupport().then((found) => live && setSupport(found));
    ask();
    window.addEventListener(SPEECH_CHANGED, ask);
    return () => {
      live = false;
      window.removeEventListener(SPEECH_CHANGED, ask);
    };
  }, []);
  return support;
}

/** Fired in the window when the models in use change (`speechModels.ts`). */
export const SPEECH_CHANGED = "misty:speech-changed";

/** A region for each language Settings offers. */
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

/** The recognition language from Settings › Voice; undefined is the system's own. */
export function recognitionLanguage(): string | undefined {
  const language = chosen().language;
  return language === "auto" ? undefined : (regions[language] ?? language);
}

/**
 * The languages the person speaks, as Settings › Voice has them: the main one, then the second
 * when it's set and differs. Each is a region, or undefined for the system's own.
 */
export function recognitionLanguages(): (string | undefined)[] {
  const first = recognitionLanguage();
  const second = chosen().secondLanguage;
  const extra = second === "none" ? undefined : (regions[second] ?? second);
  return extra && extra !== first ? [first, extra] : [first];
}

/** Recognizes a recorded audio file on this computer. */
export function recognizeFile(path: string): Promise<string> {
  return invoke<string>("speech_recognize_file", { path });
}

/** A recording's bytes as base64, the way the recognizer commands take them. */
async function base64Of(audio: Blob): Promise<string> {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** Recognizes a recording held in memory, such as the chat microphone's. */
export async function recognizeAudio(audio: Blob): Promise<string> {
  return invoke<string>("speech_recognize_audio", {
    audio: await base64Of(audio),
    mime: audio.type,
  });
}

/** A word heard in a recording, and when: seconds from the recording's start. */
export interface HeardWord {
  text: string;
  start: number;
  end: number;
}

/** Recognizes a recording held in memory word by word, with each word's time, for captions. */
export async function recognizeAudioWords(audio: Blob): Promise<HeardWord[]> {
  return invoke<HeardWord[]>("speech_recognize_audio_words", {
    audio: await base64Of(audio),
    mime: audio.type,
  });
}

/** What a hearing session tells, for one of its inputs. */
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

/**
 * A live hearing session over named inputs: the person's microphone (`mic`), or audio the window
 * feeds (`push`, such as each person in a call). The voice activity detector finds where each
 * input speaks; what it says arrives through `onEvent` once they pause.
 */
export interface HearingSession {
  /** Hears this computer's microphone directly, as `input`. */
  mic(input: string): Promise<void>;
  /** Feeds 16 kHz mono PCM16 little-endian samples, as base64, from `input`. */
  push(input: string, pcm: string): void;
  /** Forgets what `input` has said so far, such as Misty's own voice through the speakers. */
  reset(input: string): void;
  /** Stops hearing `input`. */
  remove(input: string): void;
  /** Ends the session; settles once everything said before has been told. */
  stop(): Promise<void>;
}

/** Opens a hearing session. Fails with why when the hearing model isn't set up here. */
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
  // Audio goes over in the order it came, and stop waits for the last of it.
  let pushing: Promise<unknown> = Promise.resolve();
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
  // A page that goes away (a reload) closes its session, and the microphone with it.
  window.addEventListener("pagehide", stop);
  return {
    mic: (input) => invoke<void>("speech_hear_mic", { session, input }),
    push(input, pcm) {
      if (stopping) return;
      pushing = pushing
        .then(() => invoke("speech_hear_push", { session, input, pcm }))
        .catch(() => undefined);
    },
    reset: (input) => void invoke("speech_hear_reset", { session, input }).catch(() => undefined),
    remove: (input) => void invoke("speech_hear_remove", { session, input }).catch(() => undefined),
    stop,
  };
}

/** The microphone, heard as it's spoken. */
export interface Listening {
  /** Stops and answers everything heard. */
  stop(): Promise<string>;
}

/**
 * Hears the microphone until stopped; `onHeard` gets everything said so far each time more is
 * heard (once the person pauses), and once more with `final` when it's stopped.
 */
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

/** Says `text` aloud in `voice` (a catalog id; Misty's own when left out) at the pace from
 * Settings › Voice; settles when done or stopped. */
export function say(text: string, voice?: string): Promise<void> {
  return invoke<void>("speech_say", {
    text,
    voice: voice || undefined,
    rate: chosen().speakingRate,
  });
}

/** Plays a voice's sample, for picking one. */
export function previewVoice(voice: string, text: string): Promise<void> {
  return invoke<void>("speech_preview", { voice, text });
}

/** Speech made from text without playing it, for an agent's voice in a call. */
export interface RenderedSpeech {
  /** Mono PCM16 little-endian, as base64. */
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

/**
 * A reply read aloud while it's still being written, in `voice` (Misty's own when left out) at
 * the pace from Settings › Voice: each sentence handed to `add` is read straight after the one
 * before. The voice is set up as soon as this is called, so open it before the first sentence
 * exists. `end` settles once everything has been read, or it was stopped (`stopSaying`, or
 * anything else said).
 */
export interface Reading {
  add(sentence: string): void;
  /** How many sentences the voice has begun, as native code has told; every one, as a very
   * large number, once it's over. Read locally: nothing is asked. */
  started(): number;
  /** Runs `listener` with the count each time another sentence begins; returns its removal. */
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
  // Sentences go over in order, each after the one before has been handed on.
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
        // A voice that never opened holds nothing back.
      } finally {
        over = true;
        tell();
        stopListening();
      }
    },
  };
}

/** Whether this computer's sound is off, so a spoken answer would go unheard. */
export const outputMuted = () => invoke<boolean>("speech_output_muted").catch(() => false);

/** Whether another app is using the microphone, as on a call: no unasked-for speech then. */
export const onCall = () => invoke<boolean>("speech_on_call").catch(() => false);

/** Turns the sound back on, at half if it was all the way down (macOS). */
export const soundOn = () => invoke<void>("speech_sound_on");

/** Puts an answer that couldn't be heard on the clipboard. */
export const copyAnswer = (text: string) => invoke<void>("speech_copy_answer", { text });

/** Stops whatever Misty is saying. */
export function stopSaying(): Promise<void> {
  return invoke<void>("speech_stop").catch(() => undefined);
}

/** Misty's own voice from Settings › Voice (a catalog id), for audio overviews; undefined when
 * none is picked yet. */
export function chosenVoice(): string | undefined {
  return chosen().voice || undefined;
}
