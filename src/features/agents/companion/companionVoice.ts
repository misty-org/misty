import { agentsApi } from "@/api/agents/api";
import { resolveApiBase } from "@/api/deployment/api";
import { ensureServerAgentDevice } from "../store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import { CompanionVoicePlayback } from "./companionVoicePlayback";
import { CompanionVoiceWebRTC } from "./companionVoiceWebRTC";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Input and output phases do not start together. Rejection before a phase is
  // awaited is still handled, while its eventual caller receives the rejection.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

export interface CompanionVoiceOptions {
  signal: AbortSignal;
  assertCurrent: () => void;
  onPlaying: () => void;
  onError: (error: Error) => void;
}

/** One native turn, one server-owned provider session, no automatic replay. */
export class CompanionVoice {
  private socket?: WebSocket;
  private ready = deferred<void>();
  private transcript = deferred<string>();
  private output = deferred<void>();
  private closed = false;
  private committed = false;
  private responding = false;
  private serverDone = false;
  private inputFinal = false;
  private readyReceived = false;
  private sequence = 0;
  private inputBytes = 0;
  private queued: string[] = [];
  private playback?: CompanionVoicePlayback;
  private rtc?: CompanionVoiceWebRTC;
  private rtcConnected?: Promise<void>;
  private fallback = false;
  private attempt = 0;
  private history: string[] = [];
  private timeout?: ReturnType<typeof setTimeout>;
  private ping?: ReturnType<typeof setInterval>;
  private abort = () => this.close();

  constructor(private options: CompanionVoiceOptions) {
    options.signal.addEventListener("abort", this.abort, { once: true });
    if (options.signal.aborted) this.close();
    else {
      this.deadline(20_000, "The voice session could not start.");
      void this.connect().catch((error: unknown) => this.fail(error));
    }
  }

  private current() {
    if (this.closed || this.options.signal.aborted) throw new Error("Voice turn cancelled.");
    this.options.assertCurrent();
  }

  private async connect() {
    const attempt = ++this.attempt;
    const snapshot = await agentsDeviceSnapshot();
    this.current();
    if (!snapshot.device || snapshot.device.status === "revoked")
      throw new Error("This Misty device is unavailable.");
    const device = await ensureServerAgentDevice(snapshot.device);
    this.current();
    const { ticket, webrtc } = await agentsApi.realtimeVoiceTicket(device.id, this.options.signal);
    const base = await resolveApiBase();
    this.current();
    const url = new URL(`${base}/agent-voice/realtime`, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let offer: string | undefined;
    if (webrtc && !this.fallback && typeof RTCPeerConnection !== "undefined") {
      this.deadline(45_000, "The WebRTC voice session could not start.");
      try {
        this.rtc = new CompanionVoiceWebRTC((error) => this.transportFailed(error));
        offer = await this.rtc.offer();
        this.current();
        url.searchParams.set("transport", "webrtc");
      } catch {
        this.rtc?.close();
        this.rtc = undefined;
        this.fallback = true;
      }
    }
    this.current();
    if (attempt !== this.attempt) return;
    const socket = new WebSocket(url, ["misty-voice-v1", `misty-voice-auth.${ticket}`]);
    this.socket = socket;
    socket.onopen = () => {
      if (offer && attempt === this.attempt && !this.closed)
        this.send({ type: "rtc.offer", sdp: offer });
    };
    socket.onmessage = (event) => {
      if (this.closed || attempt !== this.attempt) return;
      try {
        this.current();
        this.receive(JSON.parse(event.data));
      } catch (error) {
        this.fail(error);
      }
    };
    socket.onerror = () => {
      if (attempt === this.attempt) this.transportFailed(new Error("The voice connection failed."));
    };
    socket.onclose = () => {
      if (attempt !== this.attempt) return;
      clearInterval(this.ping);
      if (!this.closed && !this.serverDone)
        this.transportFailed(new Error("The voice connection stopped. Please try again."));
    };
  }

  private send(event: object) {
    this.current();
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 3 * 1024 * 1024)
      throw new Error("The voice connection cannot keep up with recording.");
    this.socket.send(JSON.stringify(event));
  }

  private receive(event: {
    type: string;
    text?: string;
    audio?: string;
    message?: string;
    sdp?: string;
  }) {
    switch (event.type) {
      case "rtc.answer": {
        if (!this.rtc || !event.sdp || this.rtcConnected)
          throw new Error("Unexpected WebRTC answer.");
        const attempt = this.attempt;
        this.rtcConnected = this.rtc.answer(event.sdp);
        void this.rtcConnected.catch((error) => {
          if (attempt === this.attempt) this.transportFailed(error);
        });
        break;
      }
      case "transport.fallback":
        if (!this.rtc || this.readyReceived || this.committed)
          throw new Error("Unexpected voice fallback.");
        this.rtc.close();
        this.rtc = undefined;
        this.fallback = true;
        break;
      case "ready": {
        if (this.readyReceived) throw new Error("Duplicate voice session setup.");
        const attempt = this.attempt;
        void (async () => {
          if (this.rtc) {
            if (!this.rtcConnected) throw new Error("Missing WebRTC answer.");
            await this.rtcConnected;
          }
          this.current();
          if (attempt !== this.attempt) return;
          this.readyReceived = true;
          clearTimeout(this.timeout);
          for (const audio of this.queued) this.sendAudio(audio);
          this.queued = [];
          this.ready.resolve();
        })().catch((error) => {
          if (attempt === this.attempt) this.transportFailed(error);
        });
        this.ping = setInterval(() => {
          try {
            this.send({ type: "ping" });
          } catch (error) {
            this.fail(error);
          }
        }, 20_000);
        break;
      }
      case "transcript":
        if (!this.committed || this.inputFinal || typeof event.text !== "string")
          throw new Error("Unexpected voice transcript.");
        this.inputFinal = true;
        clearTimeout(this.timeout);
        this.transcript.resolve(event.text);
        break;
      case "audio":
        if (!this.responding || !this.playback || !event.audio || this.serverDone)
          throw new Error("Unexpected voice output.");
        this.deadline(30_000, "Voice generation stopped making progress.");
        this.playback.append(event.audio);
        break;
      case "done":
        if (!this.responding || (!this.playback && !this.rtc) || this.serverDone)
          throw new Error("Unexpected voice completion.");
        this.serverDone = true;
        clearTimeout(this.timeout);
        clearInterval(this.ping);
        if (this.rtc) {
          void this.rtc
            .finishOutput()
            .then(() => {
              if (!this.closed) this.output.resolve();
            })
            .catch((error) => this.fail(error));
        } else this.playback?.finish();
        break;
      case "playing":
        if (!this.rtc || !this.responding) throw new Error("Unexpected voice playback.");
        this.options.onPlaying();
        this.deadline(130_000, "Voice playback did not finish.");
        break;
      case "error":
        // Admission, ownership, accounting and provider protocol errors are
        // authoritative. Only transport loss/negotiation selects a fallback.
        this.fail(new Error(event.message || "The voice session failed."));
        break;
      case "pong":
        break;
      default:
        throw new Error("Unsupported voice response.");
    }
  }

  append(sequence: number, audio: string) {
    try {
      this.current();
      if (this.committed || sequence !== this.sequence + this.queued.length)
        throw new Error("Voice audio arrived out of order.");
      this.inputBytes += atob(audio).length;
      if (this.inputBytes > 24000 * 2 * 60) throw new Error("Voice recording is too long.");
      this.history.push(audio);
      // Ready is an application event, not merely an open socket.
      if (this.readyReceived) this.sendAudio(audio);
      else this.queued.push(audio);
    } catch (error) {
      this.fail(error);
    }
  }

  async commit(): Promise<string> {
    await this.ready.promise;
    while (!this.readyReceived && !this.closed) await this.ready.promise;
    this.current();
    if (this.committed) throw new Error("Voice was already submitted.");
    this.committed = true;
    if (this.rtc) {
      this.deadline(70_000, "Voice input did not finish.");
      await this.rtc.finishInput();
      this.current();
    }
    this.history = [];
    this.send({ type: "audio.commit", audio_bytes: this.inputBytes });
    this.deadline(50_000, "Voice transcription did not finish.");
    return this.transcript.promise;
  }

  async speak(invocationId: string): Promise<void> {
    await this.ready.promise;
    while (!this.readyReceived && !this.closed) await this.ready.promise;
    this.current();
    if (this.responding) throw new Error("Voice output already started.");
    this.responding = true;
    if (this.rtc) {
      this.send({ type: "reply", invocation_id: invocationId });
      this.deadline(50_000, "Voice generation did not start.");
      return this.output.promise;
    }
    this.playback = new CompanionVoicePlayback(
      this.options.onPlaying,
      () => this.output.resolve(),
      (error) => this.fail(error),
    );
    this.deadline(10_000, "Audio playback could not start.");
    await this.playback.start();
    this.current();
    this.send({ type: "reply", invocation_id: invocationId });
    this.deadline(50_000, "Voice generation did not start.");
    return this.output.promise;
  }

  private deadline(ms: number, message: string) {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.fail(new Error(message)), ms);
  }
  private sendAudio(audio: string) {
    if (this.rtc) this.rtc.append(audio);
    else this.send({ type: "audio.append", sequence: this.sequence, audio });
    this.sequence++;
  }
  private transportFailed(reason: unknown) {
    if (this.closed || this.serverDone) return;
    if (this.rtc && !this.fallback && !this.committed && !this.responding) {
      this.fallback = true;
      ++this.attempt; // invalidate every callback belonging to the old socket
      this.rtc.close();
      this.rtc = undefined;
      this.rtcConnected = undefined;
      this.socket?.close();
      if (this.readyReceived) this.ready = deferred<void>();
      this.readyReceived = false;
      this.sequence = 0;
      this.queued = [...this.history];
      clearInterval(this.ping);
      this.deadline(20_000, "The voice relay could not start.");
      void this.connect().catch((error) => this.fail(error));
    } else this.fail(reason);
  }
  private fail(reason: unknown) {
    if (this.closed) return;
    const error = reason instanceof Error ? reason : new Error("The voice session failed.");
    this.close(error);
    this.options.onError(error);
  }
  close(error = new Error("Voice turn cancelled.")) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    clearInterval(this.ping);
    this.options.signal.removeEventListener("abort", this.abort);
    this.ready.reject(error);
    this.transcript.reject(error);
    this.output.reject(error);
    this.queued = [];
    this.history = [];
    this.rtc?.close();
    this.playback?.close();
    if (this.socket) {
      this.socket.onerror = null;
      this.socket.close();
    }
  }
}
