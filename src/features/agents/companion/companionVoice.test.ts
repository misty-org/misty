import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionVoice } from "./companionVoice";

const mocks = vi.hoisted(() => ({
  ticket: vi.fn(),
  start: vi.fn(),
  append: vi.fn(),
  close: vi.fn(),
  finish: vi.fn(),
  rtcOffer: vi.fn(),
  rtcAnswer: vi.fn(),
  rtcAppend: vi.fn(),
  rtcClose: vi.fn(),
  rtcDrain: vi.fn(),
  rtcOutputDrain: vi.fn(),
  rtcFailure: undefined as undefined | ((error: Error) => void),
}));
vi.mock("./companionVoiceWebRTC", () => ({
  CompanionVoiceWebRTC: class {
    constructor(onError: (error: Error) => void) {
      mocks.rtcFailure = onError;
    }
    offer = mocks.rtcOffer;
    answer = mocks.rtcAnswer;
    append = mocks.rtcAppend;
    close = mocks.rtcClose;
    finishInput = mocks.rtcDrain;
    finishOutput = mocks.rtcOutputDrain;
  },
}));
vi.mock("@/api/agents/api", () => ({ agentsApi: { realtimeVoiceTicket: mocks.ticket } }));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "https://fixture.test/v1" }));
vi.mock("../store/useAgentsStore", () => ({
  agentsDeviceSnapshot: async () => ({ device: { id: "local", status: "active" } }),
}));
vi.mock("../store/useAgentDeviceStore", () => ({
  ensureServerAgentDevice: async () => ({ id: "server-device" }),
}));
vi.mock("./companionVoicePlayback", () => ({
  CompanionVoicePlayback: class {
    constructor(
      private playing: () => void,
      private done: () => void,
    ) {}
    start = mocks.start;
    append(audio: string) {
      mocks.append(audio);
      this.playing();
    }
    finish() {
      mocks.finish();
      this.done();
    }
    close = mocks.close;
  },
}));

class FixtureSocket {
  static OPEN = 1;
  static instances: FixtureSocket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  onopen?: () => void;
  sent: Record<string, unknown>[] = [];
  constructor(
    readonly url: URL,
    readonly protocols: string[],
  ) {
    FixtureSocket.instances.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  receive(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
let sessions: CompanionVoice[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  FixtureSocket.instances = [];
  mocks.ticket.mockResolvedValue({ ticket: "one-use-ticket" });
  mocks.start.mockResolvedValue(undefined);
  mocks.rtcOffer.mockResolvedValue("v=0 fixture-offer");
  mocks.rtcAnswer.mockResolvedValue(undefined);
  mocks.rtcDrain.mockResolvedValue(undefined);
  mocks.rtcOutputDrain.mockResolvedValue(undefined);
  mocks.rtcFailure = undefined;
  vi.stubGlobal("WebSocket", FixtureSocket);
});
afterEach(() => {
  sessions.forEach((session) => session.close());
  sessions = [];
  vi.unstubAllGlobals();
});
async function fixture() {
  const abort = new AbortController(),
    onError = vi.fn(),
    onPlaying = vi.fn(),
    assertCurrent = vi.fn();
  const session = new CompanionVoice({ signal: abort.signal, assertCurrent, onError, onPlaying });
  sessions.push(session);
  await vi.waitFor(() => expect(FixtureSocket.instances).toHaveLength(1));
  return { session, abort, onError, onPlaying, assertCurrent, socket: FixtureSocket.instances[0] };
}

describe("native voice session transport", () => {
  it("does not retry admission or account failures through another transport", async () => {
    vi.stubGlobal("RTCPeerConnection", class {});
    mocks.ticket.mockResolvedValue({ ticket: "rtc-ticket", webrtc: true });
    const { socket, onError } = await fixture();
    socket.receive({ type: "error", message: "Voice admission failed." });
    expect(onError).toHaveBeenCalledOnce();
    expect(mocks.ticket).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(3);
  });
  it("uses WebRTC media for both directions while relaying only SDP and control", async () => {
    vi.stubGlobal("RTCPeerConnection", class {});
    mocks.ticket.mockResolvedValue({ ticket: "rtc-ticket", webrtc: true });
    const { session, socket, onError } = await fixture();
    socket.onopen?.();
    expect(socket.url.searchParams.get("transport")).toBe("webrtc");
    expect(socket.sent).toEqual([{ type: "rtc.offer", sdp: "v=0 fixture-offer" }]);
    session.append(0, "AAAAAA==");
    const transcript = session.commit();
    socket.receive({ type: "rtc.answer", sdp: "v=0 fixture-answer" });
    socket.receive({ type: "ready" });
    await vi.waitFor(() => expect(socket.sent.slice(-1)[0]?.type).toBe("audio.commit"));
    expect(mocks.rtcAppend).toHaveBeenCalledWith("AAAAAA==");
    expect(mocks.rtcDrain).toHaveBeenCalledOnce();
    expect(socket.sent.some((e) => e.type === "audio.append")).toBe(false);
    socket.receive({ type: "transcript", text: "fixture" });
    expect(await transcript).toBe("fixture");
    const spoken = session.speak("owned");
    await vi.waitFor(() => expect(socket.sent.slice(-1)[0]?.type).toBe("reply"));
    socket.receive({ type: "playing" });
    socket.receive({ type: "done" });
    socket.close();
    await spoken;
    expect(mocks.start).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
  it("falls back once after failed ICE without losing a pending hold-to-talk release", async () => {
    vi.stubGlobal("RTCPeerConnection", class {});
    mocks.ticket.mockResolvedValue({ ticket: "rtc-ticket", webrtc: true });
    mocks.rtcAnswer.mockImplementationOnce(() => new Promise(() => {}));
    const { session, socket, onError } = await fixture();
    session.append(0, "AAAAAA==");
    const transcript = session.commit();
    socket.receive({ type: "rtc.answer", sdp: "v=0 answer" });
    socket.receive({ type: "ready" });
    mocks.rtcFailure?.(new Error("ICE failed"));
    await vi.waitFor(() => expect(FixtureSocket.instances).toHaveLength(2));
    const relay = FixtureSocket.instances[1];
    expect(relay.url.search).toBe("");
    relay.receive({ type: "ready" });
    await vi.waitFor(() =>
      expect(relay.sent.map((e) => e.type)).toEqual(["audio.append", "audio.commit"]),
    );
    relay.receive({ type: "transcript", text: "recovered" });
    expect(await transcript).toBe("recovered");
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.rtcClose).toHaveBeenCalledOnce();
  });
  it("accepts server setup fallback and never repeats a committed turn after media failure", async () => {
    vi.stubGlobal("RTCPeerConnection", class {});
    mocks.ticket.mockResolvedValue({ ticket: "rtc-ticket", webrtc: true });
    const { session, socket } = await fixture();
    session.append(0, "AAAAAA==");
    socket.receive({ type: "transport.fallback", transport: "websocket" });
    socket.receive({ type: "ready" });
    const transcript = session.commit();
    await vi.waitFor(() => expect(socket.sent.slice(-1)[0]?.type).toBe("audio.commit"));
    socket.onerror?.();
    await expect(transcript).rejects.toThrow("connection failed");
    expect(mocks.ticket).toHaveBeenCalledOnce();
  });
  it("authenticates with a one-use ticket and queues native chunks until server readiness", async () => {
    const { session, socket } = await fixture();
    session.append(0, "AAAAAA==");
    session.append(1, "AAAAAA==");
    const transcript = session.commit();
    expect(socket.sent).toEqual([]);
    socket.receive({ type: "ready" });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    expect(socket.sent.map((e) => e.type)).toEqual([
      "audio.append",
      "audio.append",
      "audio.commit",
    ]);
    expect(socket.sent.slice(0, 2).map((e) => e.sequence)).toEqual([0, 1]);
    socket.receive({ type: "transcript", text: "Read this screen." });
    expect(await transcript).toBe("Read this screen.");
    expect(socket.url.href).toBe("wss://fixture.test/v1/agent-voice/realtime");
    expect(socket.url.search).toBe("");
    expect(socket.protocols).toEqual(["misty-voice-v1", "misty-voice-auth.one-use-ticket"]);
  });
  it("speaks only an invocation ID and lets queued playback finish after server close", async () => {
    const { session, socket, onPlaying, onError } = await fixture();
    socket.receive({ type: "ready" });
    const spoken = session.speak("owned-invocation");
    await vi.waitFor(() =>
      expect(socket.sent).toEqual([{ type: "reply", invocation_id: "owned-invocation" }]),
    );
    socket.receive({ type: "audio", audio: "AAAAAA==" });
    expect(onPlaying).toHaveBeenCalledOnce();
    socket.receive({ type: "done" });
    socket.close();
    await spoken;
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.append).toHaveBeenCalledWith("AAAAAA==");
  });
  it("rejects speech arriving before an owned backend reply", async () => {
    const { socket, onError } = await fixture();
    socket.receive({ type: "ready" });
    socket.receive({ type: "audio", audio: "AAAAAA==" });
    expect(onError).toHaveBeenCalledOnce();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(3);
  });
  it("rejects out-of-order native frames without replay", async () => {
    const { session, socket, onError } = await fixture();
    socket.receive({ type: "ready" });
    session.append(1, "AAAAAA==");
    expect(onError).toHaveBeenCalledOnce();
    expect(socket.sent).toEqual([]);
  });
  it("cancels pending input and ignores late messages after account/turn cancellation", async () => {
    const { session, socket, abort, onPlaying } = await fixture();
    socket.receive({ type: "ready" });
    const transcript = session.commit();
    await Promise.resolve();
    abort.abort();
    await expect(transcript).rejects.toThrow("cancelled");
    socket.receive({ type: "transcript", text: "stale" });
    socket.receive({ type: "audio", audio: "AAAAAA==" });
    expect(onPlaying).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("does not request paid output when playback cannot start", async () => {
    const { session, socket } = await fixture();
    socket.receive({ type: "ready" });
    mocks.start.mockRejectedValue(new Error("Playback unavailable"));
    await expect(session.speak("owned")).rejects.toThrow("Playback unavailable");
    expect(socket.sent).toEqual([]);
  });
  it("fails on a dead connection while backend work is pending", async () => {
    const { socket, onError } = await fixture();
    socket.receive({ type: "ready" });
    socket.close();
    expect(onError).toHaveBeenCalledOnce();
  });
  it("checks current account again before accepting provider events", async () => {
    const { socket, assertCurrent, onError } = await fixture();
    assertCurrent.mockImplementation(() => {
      throw new Error("Account changed");
    });
    socket.receive({ type: "ready" });
    expect(onError).toHaveBeenCalledOnce();
    expect(socket.sent).toEqual([]);
  });
});
