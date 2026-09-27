import { Transcript, type Segment } from "@audeeo/core";

export type LiveChannel = "mic" | "system";

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

export type RelayMessage =
  | { type: "ready"; channels: LiveChannel[]; maxMs: number }
  | { type: "segment"; segment: Segment }
  | { type: "limit"; message: string }
  | { type: "error"; message: string }
  | { type: "finished"; usedMs: number };

export interface LiveTranscriberEvents {
  /** The transcript changed (a segment was added or revised). */
  onChange?(transcript: Transcript): void;
  /** A plain-language problem; the session has ended or will end. */
  onNotice?(message: string): void;
}

/** Audio held before the relay is ready: what was said while connecting. */
const PREROLL_LIMIT_BYTES = 30 * 16_000 * 2;
const channelByte: Record<LiveChannel, number> = { mic: 0, system: 1 };

/**
 * One live transcription session against Misty's relay. Audio pushed before
 * the socket is ready is kept (up to 30 s) and sent first, so speech that
 * starts on key-down is never lost while the ticket and socket open.
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
    private readonly open: (url: string) => SocketLike = (url) =>
      new WebSocket(url) as unknown as SocketLike,
  ) {}

  /** Connects with a ticket; resolves once the relay is listening. */
  connect(
    url: string,
    ticket: string,
    start: { language?: string; context?: { terms?: string[]; text?: string } },
  ) {
    return new Promise<void>((resolve, reject) => {
      if (this.ended) return reject(new Error("Dictation ended."));
      const socket = this.open(`${url}?ticket=${encodeURIComponent(ticket)}`);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "start", ...start }));
      socket.onerror = () => reject(new Error("Live transcription couldn't connect."));
      socket.onclose = () => {
        this.ended = true;
        this.finished?.();
        reject(new Error("Live transcription closed."));
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
