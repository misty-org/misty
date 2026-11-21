import { listen as listenEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings";
import { invoke } from "@/native/invoke";
import { voiceSettings } from "./voiceSettings";

/**
 * Speech on this computer, with no key: what the person says, recognized by the system (Apple's
 * Speech framework, on-device where the language has it), and Misty speaking in a system voice.
 * The chat microphone, dictation, recordings, audio overviews and Tutor all go through here.
 */

export interface SystemVoice {
  id: string;
  name: string;
  language: string;
}

export interface SpeechSupport {
  /** Whether this computer can recognize speech: microphones show only then. */
  recognition: boolean;
  voices: SystemVoice[];
}

const none: SpeechSupport = { recognition: false, voices: [] };
let asked: Promise<SpeechSupport> | null = null;

/** What this computer can do with speech, asked once per session. */
export function speechSupport(): Promise<SpeechSupport> {
  asked ??= invoke<SpeechSupport>("speech_support").catch(() => none);
  return asked;
}

/** The same, for a component: null until it's known. */
export function useSpeechSupport(): SpeechSupport | null {
  const [support, setSupport] = useState<SpeechSupport | null>(null);
  useEffect(() => {
    let live = true;
    void speechSupport().then((found) => live && setSupport(found));
    return () => {
      live = false;
    };
  }, []);
  return support;
}

/** A region for each language Settings offers, since recognizers are per region. */
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
 * The languages Tutor listens in: the recognition language, then the second one from Settings ›
 * Voice when it's set and differs. Each is a region, or undefined for the system's own.
 */
export function recognitionLanguages(): (string | undefined)[] {
  const first = recognitionLanguage();
  const second = chosen().secondLanguage;
  const extra = second === "none" ? undefined : (regions[second] ?? second);
  return extra && extra !== first ? [first, extra] : [first];
}

/** Recognizes a recorded audio file on this computer. */
export function recognizeFile(path: string): Promise<string> {
  return invoke<string>("speech_recognize_file", { path, language: recognitionLanguage() });
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
    language: recognitionLanguage(),
  });
}

/** A word heard in a recording, and when: seconds from the recording's start. */
export interface HeardWord {
  text: string;
  start: number;
  end: number;
}

/**
 * Recognizes a recording held in memory word by word, with each word's time, for captions. The
 * language (a code such as "en") is Settings › Voice's when not given.
 */
export async function recognizeAudioWords(audio: Blob, language?: string): Promise<HeardWord[]> {
  return invoke<HeardWord[]>("speech_recognize_audio_words", {
    audio: await base64Of(audio),
    mime: audio.type,
    language: language ? (regions[language] ?? language) : recognitionLanguage(),
  });
}

/** The microphone, recognized as it's spoken. */
export interface Listening {
  /** Stops and answers everything heard. */
  stop(): Promise<string>;
}

/**
 * Starts recognizing the microphone; `onHeard` gets the words so far as they change, and once
 * more with `final` when the recognizer is done.
 */
export async function listen(
  onHeard: (heard: { text: string; final: boolean; error?: string }) => void,
): Promise<Listening> {
  let session = 0;
  const early: { session: number; text: string; final: boolean; error?: string }[] = [];
  const unlisten: UnlistenFn = await listenEvent<{
    session: number;
    text: string;
    final: boolean;
    error?: string | null;
  }>("misty://speech-heard", (event) => {
    const heard = { ...event.payload, error: event.payload.error ?? undefined };
    if (!session) return void early.push(heard);
    if (heard.session === session) onHeard(heard);
  });
  try {
    session = await invoke<number>("speech_listen_start", { language: recognitionLanguage() });
  } catch (error) {
    unlisten();
    throw error;
  }
  for (const heard of early) if (heard.session === session) onHeard(heard);
  return {
    async stop() {
      try {
        return await invoke<string>("speech_listen_stop", { session });
      } finally {
        unlisten();
      }
    },
  };
}

/** Says `text` aloud in the voice and pace from Settings › Voice, or in `voice` when given (an
 * agent's own); settles when done or stopped. */
export function say(text: string, voice?: string): Promise<void> {
  const { systemVoice, speakingRate } = chosen();
  return invoke<void>("speech_say", {
    text,
    voice: voice || systemVoice || undefined,
    rate: speakingRate,
  });
}

/**
 * A reply read aloud while it's still being written, in the voice and pace from Settings › Voice:
 * each sentence handed to `add` is read straight after the one before. The voice is set up as
 * soon as this is called, so open it before the first sentence exists. `end` settles once
 * everything has been read, or it was stopped (`stopSaying`, or anything else said).
 */
export interface Reading {
  add(sentence: string): void;
  /** How many sentences the voice has begun; every one, as a very large number, once it's over. */
  started(): Promise<number>;
  end(): Promise<void>;
}

export function openReading(): Reading {
  const { systemVoice, speakingRate } = chosen();
  const opened = invoke<number>("speech_reading_start", {
    voice: systemVoice || undefined,
    rate: speakingRate,
  });
  // Sentences go over in order, each after the one before has been handed on.
  let sent: Promise<unknown> = opened;
  return {
    add(sentence) {
      if (!sentence.trim()) return;
      sent = sent
        .then(() => opened)
        .then((reading) => invoke("speech_reading_add", { reading, text: sentence }))
        .catch(() => undefined);
    },
    async started() {
      try {
        return await invoke<number>("speech_reading_progress", { reading: await opened });
      } catch {
        // A voice that never opened holds nothing back.
        return Number.MAX_SAFE_INTEGER;
      }
    },
    async end() {
      await sent.catch(() => undefined);
      const reading = await opened;
      await invoke("speech_reading_end", { reading });
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

/** The voice chosen in Settings › Voice, for audio overviews; undefined is the system's. */
export function chosenVoice(): string | undefined {
  return chosen().systemVoice || undefined;
}
