import { describe, expect, it } from "vitest";
import { LiveTranscriber, type SocketLike } from "./liveTranscriber";

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 1;
  sent: (string | Uint8Array)[] = [];
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  constructor(public url: string) {}
  send(data: string | ArrayBufferLike | ArrayBufferView) {
    this.sent.push(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer));
    if (typeof data === "string" && JSON.parse(data).type === "finish")
      this.relay({ type: "finished", usedMs: 40 });
  }
  close() {}
  relay(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const segment = (id: string, text: string, final: boolean, revision = 1) => ({
  id,
  sessionId: "s",
  sequence: Number(id),
  revision,
  startMs: Number(id) * 100,
  endMs: 0,
  sourceLanguage: "en",
  targetLanguage: "en",
  sourceText: text,
  translatedText: "",
  final,
  state: final ? "complete" : "provisional",
  channel: "mic",
});

describe("LiveTranscriber", () => {
  it("keeps audio spoken before the relay is ready and sends it first", async () => {
    let socket!: FakeSocket;
    const live = new LiveTranscriber({}, (url) => (socket = new FakeSocket(url)));
    live.push("mic", Uint8Array.from([1, 2]));
    const connected = live.connect("wss://relay/v1/live/transcribe", "v1.a.b", {
      language: "en",
      context: { terms: ["Misty"] },
    });
    expect(socket.url).toBe("wss://relay/v1/live/transcribe?ticket=v1.a.b");
    socket.onopen?.({});
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: "start",
      language: "en",
      context: { terms: ["Misty"] },
    });
    live.push("mic", Uint8Array.from([3, 4]));
    expect(socket.sent).toHaveLength(1);
    socket.relay({ type: "ready", channels: ["mic"], maxMs: 60000 });
    await connected;
    live.push("mic", Uint8Array.from([5, 6]));
    expect(socket.sent.slice(1)).toEqual([
      Uint8Array.from([0, 1, 2]),
      Uint8Array.from([0, 3, 4]),
      Uint8Array.from([0, 5, 6]),
    ]);
  });

  it("finishes with confirmed words in order", async () => {
    let socket!: FakeSocket;
    const changes: string[] = [];
    const live = new LiveTranscriber(
      { onChange: (t) => changes.push(t.text()) },
      (url) => (socket = new FakeSocket(url)),
    );
    const connected = live.connect("wss://r", "t", {});
    socket.relay({ type: "ready", channels: ["mic"], maxMs: 1 });
    await connected;
    socket.relay({ type: "segment", segment: segment("1", "Let's move", false) });
    socket.relay({ type: "segment", segment: segment("1", "Let's move the review", true, 2) });
    socket.relay({ type: "segment", segment: segment("1", "stale", false, 1) });
    socket.relay({ type: "segment", segment: segment("2", "to Thursday .", true) });
    expect(changes).toHaveLength(3);
    expect(await live.finish()).toBe("Let's move the review to Thursday.");
  });

  it("reports the relay's notices and rejects a failed start", async () => {
    let socket!: FakeSocket;
    const notices: string[] = [];
    const live = new LiveTranscriber(
      { onNotice: (n) => notices.push(n) },
      (url) => (socket = new FakeSocket(url)),
    );
    const connected = live.connect("wss://r", "t", {});
    socket.relay({
      type: "error",
      message: "Live transcription couldn't start. Try again in a moment.",
    });
    await expect(connected).rejects.toThrow("couldn't start");
    expect(notices).toEqual(["Live transcription couldn't start. Try again in a moment."]);
  });
});
