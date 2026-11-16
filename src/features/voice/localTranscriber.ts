import { invoke } from "@/native/invoke";
import type { Channel, Segment } from "./transcript/segment";
import { Transcript } from "./transcript/transcript";
import { recognitionLanguage } from "./systemSpeech";

/** A phrase a stream heard, in seconds from its start. */
interface Phrase {
  text: string;
  start: number;
  end: number;
}

interface StreamHeard {
  segments: Phrase[];
  current?: Phrase | null;
}

/** How often each channel's words are read back while listening. */
const POLL_MS = 400;

/**
 * A live capture transcribed by this computer's own speech recognition, with no key: one stream
 * per channel (the microphone is the person, system audio is everyone else), fed the capture's
 * PCM as it arrives. It keeps the same transcript the capture panel shows; speakers within a
 * channel aren't told apart.
 */
export class LocalTranscriber {
  readonly transcript = new Transcript();
  private streams = new Map<Channel, number>();
  private timer?: ReturnType<typeof setInterval>;
  private ended = false;
  /** Each phrase's last text and how often it changed, so only changes are passed on. */
  private seen = new Map<string, { text: string; revision: number; final: boolean }>();
  private readonly sessionId = `local-${Date.now()}`;

  constructor(
    private readonly events: {
      onChange?: (transcript: Transcript) => void;
      onNotice?: (notice: string) => void;
    } = {},
  ) {}

  /** Opens a recognizer for each channel; resolves once all are listening. */
  async connect(session: { channels: Channel[] }) {
    if (this.ended) throw new Error("Listening ended.");
    const language = recognitionLanguage();
    for (const channel of session.channels) {
      const stream = await invoke<number>("speech_stream_start", { language });
      if (this.ended) {
        void invoke("speech_stream_stop", { stream }).catch(() => undefined);
        return;
      }
      this.streams.set(channel, stream);
    }
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  /** 16 kHz mono PCM16 little-endian, as base64, from one channel. */
  pushBase64(channel: Channel, pcm: string) {
    const stream = this.streams.get(channel);
    if (this.ended || stream === undefined || !pcm) return;
    void invoke("speech_stream_push", { stream, pcm }).catch(() => undefined);
  }

  private apply(channel: Channel, heard: StreamHeard) {
    let changed = false;
    const phrases = [...heard.segments, ...(heard.current ? [heard.current] : [])];
    phrases.forEach((phrase, index) => {
      const final = index < heard.segments.length;
      const id = `${channel}-${index}`;
      const before = this.seen.get(id);
      if (before && before.text === phrase.text && before.final === final) return;
      const revision = (before?.revision ?? 0) + 1;
      this.seen.set(id, { text: phrase.text, revision, final });
      const segment: Segment = {
        id,
        sessionId: this.sessionId,
        sequence: index,
        revision,
        startMs: Math.round(phrase.start * 1000),
        endMs: Math.round(phrase.end * 1000),
        sourceLanguage: "auto",
        targetLanguage: "auto",
        sourceText: phrase.text,
        translatedText: "",
        final,
        state: final ? "complete" : "provisional",
        channel,
      };
      if (this.transcript.accept(segment)) changed = true;
    });
    if (changed) this.events.onChange?.(this.transcript);
  }

  private async poll() {
    for (const [channel, stream] of this.streams) {
      const heard = await invoke<StreamHeard>("speech_stream_poll", { stream }).catch(() => null);
      if (heard && !this.ended) this.apply(channel, heard);
    }
  }

  /** Ends every stream and keeps their last words. */
  async finish(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const streams = [...this.streams];
    this.streams.clear();
    for (const [channel, stream] of streams) {
      const heard = await invoke<StreamHeard>("speech_stream_stop", { stream }).catch(() => null);
      if (heard) this.apply(channel, heard);
    }
    this.ended = true;
  }

  close() {
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    for (const stream of this.streams.values())
      void invoke("speech_stream_stop", { stream }).catch(() => undefined);
    this.streams.clear();
  }
}
