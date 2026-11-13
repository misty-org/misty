import { Channel, invoke } from "@tauri-apps/api/core";

type SessionMessage = { kind: "message"; data: string } | { kind: "closed" };

type RuntimeSession = { kind: "voice" } | { kind: "live"; channels: string[]; language: string };

const CONNECTING = 0;
export const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * A voice or live transcription session with the agent runtime in this app,
 * shaped like the WebSocket it replaces, so its users read the same way. Its messages arrive on a
 * Tauri channel and go out through a command. Each is numbered, because IPC calls don't promise to
 * arrive in the order they were made.
 */
export class RuntimeSocket {
  binaryType = "arraybuffer";
  readyState = CONNECTING;
  /** Bytes sent that the app hasn't taken yet. */
  bufferedAmount = 0;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  /** Rejects with the app's own words if the session never opened. */
  readonly opened: Promise<void>;
  private id = "";
  private next = 0;
  private waiting: { data: string }[] = [];
  private listener: ((event: { data: unknown }) => void) | null = null;

  constructor(session: RuntimeSession) {
    const onMessage = new Channel<SessionMessage>();
    onMessage.onmessage = (message) => {
      if (message.kind === "closed") this.ended();
      else this.hear({ data: message.data });
    };
    this.opened = (
      session.kind === "voice"
        ? invoke<string>("agent_runtime_voice_open", { onMessage })
        : invoke<string>("agent_runtime_live_open", {
            channels: session.channels,
            language: session.language,
            onMessage,
          })
    ).then(
      (id) => {
        this.id = id;
        if (this.readyState === CLOSING) return this.closeSession();
        this.readyState = OPEN;
        this.onopen?.({});
        this.drain();
      },
      (error: unknown) => {
        this.failed();
        throw error instanceof Error ? error : new Error(String(error));
      },
    );
    void this.opened.catch(() => {});
  }

  get onmessage() {
    return this.listener;
  }

  /** A session's first message can arrive before anyone is listening, so it waits for them. */
  set onmessage(listener: ((event: { data: unknown }) => void) | null) {
    this.listener = listener;
    void Promise.resolve().then(() => this.drain());
  }

  private hear(event: { data: string }) {
    this.waiting.push(event);
    this.drain();
  }

  private drain() {
    while (this.readyState === OPEN && this.listener && this.waiting.length)
      this.listener(this.waiting.shift()!);
  }

  send(data: string | ArrayBufferLike | ArrayBufferView) {
    if (this.readyState === CONNECTING) throw new Error("This session hasn't opened yet.");
    // A socket that's closing or closed drops what's sent to it.
    if (this.readyState !== OPEN) return;
    const bytes =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
    const number = this.next++;
    this.bufferedAmount += bytes.length;
    void invoke("agent_runtime_session_send", bytes, {
      headers: { "x-misty-session": this.id, "x-misty-number": String(number) },
    })
      .catch(() => this.failed())
      .finally(() => {
        this.bufferedAmount -= bytes.length;
      });
  }

  close() {
    if (this.readyState === CLOSED || this.readyState === CLOSING) return;
    const opening = this.readyState === CONNECTING;
    this.readyState = CLOSING;
    // Still opening: the session closes as soon as it has an ID to close.
    if (!opening) this.closeSession();
  }

  private closeSession() {
    void invoke("agent_runtime_session_close", { id: this.id }).catch(() => this.ended());
  }

  private failed() {
    if (this.readyState === CLOSED) return;
    this.onerror?.({});
    this.ended();
  }

  private ended() {
    if (this.readyState === CLOSED) return;
    // What was said before the end still arrives first, as it does on a socket.
    if (this.readyState === OPEN) this.drain();
    this.readyState = CLOSED;
    this.onclose?.({});
  }
}
