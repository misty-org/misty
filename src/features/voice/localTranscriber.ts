import type { Channel, Segment } from "./transcript/segment";
import { Transcript } from "./transcript/transcript";
import { hear, type HearingSession } from "./speech";

/**
 * A live capture transcribed by Misty's speech model on this computer, with no key: one hearing
 * session with an input per channel (the microphone is the person, system audio is everyone
 * else), fed the capture's PCM as it arrives. Each stretch of speech arrives once its speaker
 * pauses, pushed by native code; nothing is polled. It keeps the same transcript the capture
 * panel shows; speakers within a channel aren't told apart.
 */
export class LocalTranscriber {
  readonly transcript = new Transcript();
  private session?: HearingSession;
  private ended = false;
  private sequence = 0;
  private readonly sessionId = `local-${Date.now()}`;

  constructor(
    private readonly events: {
      onChange?: (transcript: Transcript) => void;
      onNotice?: (notice: string) => void;
    } = {},
  ) {}

  /** Opens the hearing session; resolves once it listens. */
  async connect(_session: { channels: Channel[] }) {
    if (this.ended) throw new Error("Listening ended.");
    const session = await hear((event) => {
      if (event.kind === "failed") {
        this.events.onNotice?.(event.error);
        return;
      }
      if (event.kind !== "heard" || !event.text.trim()) return;
      const sequence = this.sequence++;
      const segment: Segment = {
        id: `${event.input}-${sequence}`,
        sessionId: this.sessionId,
        sequence,
        revision: 1,
        startMs: Math.round(event.start * 1000),
        endMs: Math.round(event.end * 1000),
        sourceLanguage: "auto",
        targetLanguage: "auto",
        sourceText: event.text,
        translatedText: "",
        final: true,
        state: "complete",
        channel: event.input as Channel,
      };
      if (this.transcript.accept(segment)) this.events.onChange?.(this.transcript);
    });
    if (this.ended) {
      void session.stop().catch(() => undefined);
      return;
    }
    this.session = session;
  }

  /** 16 kHz mono PCM16 little-endian, as base64, from one channel. */
  pushBase64(channel: Channel, pcm: string) {
    if (this.ended || !this.session || !pcm) return;
    this.session.push(channel, pcm);
  }

  /** Ends the session and keeps the last words. */
  async finish(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    await session?.stop().catch(() => undefined);
    this.ended = true;
  }

  close() {
    this.ended = true;
    const session = this.session;
    this.session = undefined;
    void session?.stop().catch(() => undefined);
  }
}
