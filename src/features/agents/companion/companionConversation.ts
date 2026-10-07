import { agentsApi } from "@/api/agents/api";
import { resolveApiBase } from "@/api/deployment/api";
import { ensureServerAgentDevice } from "../store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import { CompanionVoicePlayback } from "./companionVoicePlayback";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
export interface ConversationTool {
  callId: string;
  name: "start_task" | "steer_task" | "cancel_task";
  instruction: string;
  key: string;
  invocationId: string;
}
export interface SavedVoiceTurn {
  id: string;
  prompt: string;
  reply: string;
  interrupted: boolean;
}
interface Options {
  conversation: () => Promise<string>;
  assertCurrent: () => void;
  onPlaying: () => void;
  onDone: (turn: SavedVoiceTurn) => void;
  onTranscript: (id: string, text: string) => void;
  onError: (error: Error) => void;
  onExpired: () => void;
  tool: (tool: ConversationTool, conversationId: string) => Promise<string | undefined>;
}

/** Persistent, push-to-talk conversation; transport loss never replays work. */
export class CompanionConversation {
  private socket?: WebSocket;
  private closed = false;
  private ready = deferred();
  private inputReady = deferred();
  private done = deferred();
  private accepted = deferred();
  private beginning = Promise.resolve();
  private generation = 0;
  private busy = false;
  private canceled = false;
  private committed = false;
  private sequence = 0;
  private bytes = 0;
  private queued: string[] = [];
  private playback?: CompanionVoicePlayback;
  private playbackReady = Promise.resolve();
  private outputBytes = 0;
  private conversationId = "";
  private calls = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private ping?: ReturnType<typeof setInterval>;
  private connectAbort = new AbortController();

  constructor(private options: Options) {
    this.deadline(25_000);
    void this.connect().catch((e) => this.fail(e));
  }
  private current() {
    if (this.closed) throw new Error("Voice session closed.");
    this.options.assertCurrent();
  }
  private async connect() {
    this.conversationId = await this.options.conversation();
    this.current();
    const snapshot = await agentsDeviceSnapshot();
    this.current();
    if (!snapshot.device || snapshot.device.status === "revoked")
      throw new Error("This device is unavailable.");
    const device = await ensureServerAgentDevice(snapshot.device);
    this.current();
    const { ticket } = await agentsApi.realtimeVoiceTicket(device.id, this.connectAbort.signal);
    const base = await resolveApiBase();
    this.current();
    const url = new URL(`${base}/agent-voice/realtime`, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("mode", "conversation");
    url.searchParams.set("conversation", this.conversationId);
    this.socket = new WebSocket(url, ["misty-voice-v1", `misty-voice-auth.${ticket}`]);
    this.socket.onmessage = ({ data }) => {
      if (this.closed) return;
      try {
        this.current();
        this.receive(JSON.parse(data));
      } catch (e) {
        this.fail(e);
      }
    };
    this.socket.onerror = () =>
      this.fail(new Error("Voice disconnected. Your task has not been replayed."));
    this.socket.onclose = () => {
      if (!this.closed) this.fail(new Error("Voice disconnected. Hold the shortcut to reconnect."));
    };
  }
  private send(event: object) {
    this.current();
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 3 * 1024 * 1024)
      throw new Error("The voice connection cannot keep up.");
    this.socket.send(JSON.stringify(event));
  }
  begin() {
    const previous = this.interrupt();
    const generation = ++this.generation;
    this.sequence = 0;
    this.bytes = 0;
    this.queued = [];
    this.beginning = (async () => {
      await this.ready.promise;
      await previous;
      this.current();
      if (generation !== this.generation) return;
      this.busy = true;
      this.canceled = false;
      this.committed = false;
      this.inputReady = deferred();
      this.done = deferred();
      this.accepted = deferred();
      this.outputBytes = 0;
      this.playback?.close();
      this.playback = new CompanionVoicePlayback(
        this.options.onPlaying,
        () => {
          if (!this.closed && !this.canceled) {
            this.send({ type: "playback.done" });
            this.playback?.close();
          }
        },
        (e) => this.fail(e),
      );
      this.playbackReady = this.playback.start();
      void this.playbackReady.catch((e) => this.fail(e));
      this.send({ type: "turn.begin" });
      this.deadline(70_000);
      await this.inputReady.promise;
    })();
    void this.beginning.catch((e) => this.fail(e));
  }
  append(sequence: number, audio: string) {
    try {
      this.current();
      if (sequence !== this.sequence + this.queued.length)
        throw new Error("Voice audio arrived out of order.");
      this.bytes += atob(audio).length;
      if (this.bytes > 24000 * 2 * 60) throw new Error("Voice recording is too long.");
      this.queued.push(audio);
      void this.beginning.then(() => this.flush()).catch((e) => this.fail(e));
    } catch (e) {
      this.fail(e);
    }
  }
  private flush() {
    this.current();
    if (!this.busy || this.committed || this.canceled) return;
    for (const audio of this.queued)
      this.send({ type: "audio.append", sequence: this.sequence++, audio });
    this.queued = [];
  }
  async commit(text?: string) {
    await this.beginning;
    this.current();
    if (!this.busy || this.canceled || this.committed)
      throw new Error("Voice turn canceled or already submitted.");
    this.flush();
    this.committed = true;
    this.send(text === undefined ? { type: "audio.commit" } : { type: "text.commit", text });
    this.deadline(90_000);
    return this.done.promise;
  }
  async readResult(invocationId: string) {
    this.begin();
    await this.beginning;
    this.current();
    this.committed = true;
    this.send({ type: "task.read", invocationId });
    this.deadline(90_000);
    return this.done.promise;
  }
  async submitText(text: string) {
    this.begin();
    await this.beginning;
    // Return admission to the composer promptly so it clears the submitted
    // draft while speech continues. Final playback has its own lifecycle.
    void this.commit(text).catch((error) => this.fail(error));
    return this.accepted.promise;
  }
  interrupt(): Promise<void> {
    this.generation++;
    if (!this.busy || this.closed) return Promise.resolve();
    if (!this.canceled) {
      this.canceled = true;
      const heard = this.playback?.heard();
      this.playback?.close();
      this.queued = [];
      try {
        this.send({ type: "turn.cancel", ...heard });
      } catch (e) {
        this.fail(e);
      }
    }
    return this.done.promise;
  }
  private receive(e: Record<string, string | boolean>) {
    switch (e.type) {
      case "ready":
        clearTimeout(this.timer);
        this.ready.resolve();
        this.ping = setInterval(() => {
          try {
            this.send({ type: "ping" });
          } catch (e) {
            this.fail(e);
          }
        }, 20_000);
        break;
      case "turn.ready":
        this.inputReady.resolve();
        break;
      case "transcript":
        this.options.onTranscript(String(e.id), String(e.text));
        this.accepted.resolve();
        break;
      case "audio": {
        if (this.canceled) return;
        if (!this.busy || typeof e.audio !== "string") throw new Error("Unexpected voice audio.");
        const playback = this.playback!;
        this.outputBytes += e.audio.length;
        this.deadline(90_000);
        void this.playbackReady
          .then(() => {
            if (!this.closed && !this.canceled && playback === this.playback)
              playback.append(e.audio as string, e.itemId as string);
          })
          .catch((error) => this.fail(error));
        break;
      }
      case "audio.done":
        if (this.canceled) return;
        if (this.outputBytes)
          void this.playbackReady
            .then(() => this.playback?.finish())
            .catch((error) => this.fail(error));
        else this.send({ type: "playback.done" });
        break;
      case "turn.done":
        this.busy = false;
        clearTimeout(this.timer);
        this.options.onDone(e as unknown as SavedVoiceTurn);
        this.done.resolve();
        break;
      case "tool.call": {
        if (this.canceled) return;
        const tool = e as unknown as ConversationTool;
        const generation = this.generation;
        if (this.calls.has(tool.callId)) throw new Error("Repeated voice action refused.");
        this.calls.add(tool.callId);
        this.deadline(90_000);
        void this.options
          .tool(tool, this.conversationId)
          .then((id) => {
            if (!this.closed && !this.canceled && generation === this.generation)
              this.send({ type: "tool.result", callId: tool.callId, invocationId: id ?? "" });
          })
          .catch(() => {
            if (!this.closed && !this.canceled && generation === this.generation)
              this.send({ type: "tool.result", callId: tool.callId, invocationId: "" });
          });
        break;
      }
      case "session.expired":
        this.close();
        this.options.onExpired();
        break;
      case "error":
        this.fail(new Error(String(e.message || "Voice session failed.")));
        break;
      case "pong":
        break;
      default:
        throw new Error("Unsupported voice event.");
    }
  }
  private deadline(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.fail(new Error("Voice stopped making progress. Try again.")),
      ms,
    );
  }
  private fail(reason: unknown) {
    if (this.closed) return;
    const error = reason instanceof Error ? reason : new Error("Voice session failed.");
    this.close(error);
    this.options.onError(error);
  }
  close(error = new Error("Voice session closed.")) {
    if (this.closed) return;
    this.closed = true;
    this.connectAbort.abort();
    clearTimeout(this.timer);
    clearInterval(this.ping);
    this.ready.reject(error);
    this.inputReady.reject(error);
    this.done.reject(error);
    this.accepted.reject(error);
    this.playback?.close();
    this.queued = [];
    this.socket?.close();
  }
}
