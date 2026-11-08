import { RuntimeSocket } from "@/api/runtime/runtimeSocket";
import { Transcript } from "./transcript/transcript";
import type { Segment } from "./transcript/segment";

export type LiveChannel = "mic" | "system";

/** What a session listens to, and how it decodes it: this device's Soniox key does the rest. */
export interface LiveSession {
  channels: LiveChannel[];
  language: string;
}

export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

type RelayMessage =
  | { type: "ready"; channels: LiveChannel[]; maxMs: number }
  | { type: "segment"; segment: Segment }
  | { type: "limit"; message: string }
  | { type: "error"; message: string }
  | { type: "finished"; usedMs: number };

interface LiveTranscriberEvents {
  /** The transcript changed (a segment was added or revised). */
  onChange?(transcript: Transcript): void;
  /** A plain-language problem; the session has ended or will end. */
  onNotice?(message: string): void;
  /** The relay's socket closed, whoever closed it. */
  onClosed?(): void;
}

/** Audio held before the relay is ready: what was said while connecting. */
const PREROLL_LIMIT_BYTES = 30 * 16_000 * 2;
const channelByte: Record<LiveChannel, number> = { mic: 0, system: 1 };

/**
 * One live transcription session against the agent runtime on this computer.
 * Audio pushed before it is ready is kept (up to 30 s) and sent first, so
 * speech that starts on key-down is never lost while the session opens.
 */
export class LiveTranscriber {
  readonly transcript = new Transcript();
  private socket?: SocketLike;
  private ready = false;
  private ended = false;
  private queued: Uint8Array[] = [];
  private queuedBytes = 0;
  private finished?: () => void;

  constructor(
    private readonly events: LiveTranscriberEvents = {},
    private readonly open: (session: LiveSession) => SocketLike = (session) =>
      new RuntimeSocket({ kind: "live", ...session }) as unknown as SocketLike,
  ) {}

  /** Opens the session; resolves once the relay is listening. */
  connect(
    session: LiveSession,
    start: {
      language?: string;
      target?: string;
      context?: {
        terms?: string[];
        text?: string;
        general?: { key: string; value: string }[];
        translation_terms?: { source: string; target: string }[];
      };
    },
  ) {
    return new Promise<void>((resolve, reject) => {
      if (this.ended) return reject(new Error("Dictation ended."));
      const socket = this.open(session);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "start", ...start }));
      socket.onerror = () => reject(new Error("Live transcription couldn't connect."));
      socket.onclose = () => {
        this.ended = true;
        this.finished?.();
        reject(new Error("Live transcription closed."));
        this.events.onClosed?.();
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let message: RelayMessage;
        try {
          message = JSON.parse(event.data) as RelayMessage;
        } catch {
          return;
        }
        if (message.type === "ready") {
          this.ready = true;
          for (const frame of this.queued) socket.send(frame);
          this.queued = [];
          this.queuedBytes = 0;
          resolve();
        } else if (message.type === "segment") {
          if (this.transcript.accept(message.segment)) this.events.onChange?.(this.transcript);
        } else if (message.type === "limit" || message.type === "error") {
          this.events.onNotice?.(message.message);
          if (message.type === "error") reject(new Error(message.message));
        } else if (message.type === "finished") {
          this.finished?.();
        }
      };
    });
  }

  /** 16 kHz mono PCM16 little-endian bytes from one channel. */
  push(channel: LiveChannel, pcm: Uint8Array) {
    if (this.ended || !pcm.length) return;
    const frame = new Uint8Array(pcm.length + 1);
    frame[0] = channelByte[channel];
    frame.set(pcm, 1);
    if (this.ready && this.socket) return this.socket.send(frame);
    this.queued.push(frame);
    this.queuedBytes += frame.length;
    while (this.queuedBytes > PREROLL_LIMIT_BYTES && this.queued.length > 1)
      this.queuedBytes -= this.queued.shift()!.length;
  }

  /** Asks the relay to finalize and waits (bounded) for the last words. */
  async finish(timeoutMs = 8000): Promise<string> {
    if (this.socket && this.ready && !this.ended) {
      const done = new Promise<void>((resolve) => {
        this.finished = resolve;
        setTimeout(resolve, timeoutMs);
      });
      this.socket.send(JSON.stringify({ type: "finish" }));
      await done;
    }
    this.close();
    return this.text();
  }

  /** Confirmed words only, in spoken order. */
  text() {
    return this.transcript
      .segments()
      .map((segment) => segment.sourceText.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1");
  }

  close() {
    this.ended = true;
    this.queued = [];
    try {
      this.socket?.close(1000, "done");
    } catch {
      // Already closed.
    }
  }
}
