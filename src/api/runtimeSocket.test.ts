import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN, RuntimeSocket } from "./runtimeSocket";

type Heard = { kind: "message"; data: string } | { kind: "closed" };

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as { onmessage?: (message: unknown) => void }[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage?: (message: unknown) => void;
    constructor() {
      mocks.channels.push(this);
    }
  },
}));

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const channel = () => mocks.channels[mocks.channels.length - 1]!;
const hear = (message: Heard) => channel().onmessage?.(message);
const sends = () => mocks.invoke.mock.calls.filter(([name]) => name === "agent_runtime_session_send");

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.channels.length = 0;
  mocks.invoke.mockImplementation(async (name: string) =>
    name.endsWith("_open") ? "session-1" : undefined,
  );
});

describe("RuntimeSocket", () => {
  it("opens a live session with its channels and language, and calls onopen", async () => {
    const socket = new RuntimeSocket({ kind: "live", channels: ["mic"], language: "en" });
    const opened = vi.fn();
    socket.onopen = opened;
    expect(() => socket.send("too soon")).toThrow();
    await socket.opened;
    expect(mocks.invoke.mock.calls[0]![0]).toBe("agent_runtime_live_open");
    expect(mocks.invoke.mock.calls[0]![1]).toMatchObject({ channels: ["mic"], language: "en" });
    expect(opened).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(OPEN);
  });

  it("numbers what it sends, as bytes, in the order it was sent", async () => {
    const socket = new RuntimeSocket({ kind: "voice" });
    await socket.opened;
    socket.send('{"type":"ping"}');
    const frame = Uint8Array.from([9, 0, 1, 2, 9]);
    socket.send(frame.subarray(1, 4));
    const [first, second] = sends();
    expect(new TextDecoder().decode(first![1] as Uint8Array)).toBe('{"type":"ping"}');
    expect(first![2]).toEqual({ headers: { "x-misty-session": "session-1", "x-misty-number": "0" } });
    expect([...(second![1] as Uint8Array)]).toEqual([0, 1, 2]);
    expect(second![2].headers["x-misty-number"]).toBe("1");
  });

  it("counts what the app hasn't taken yet", async () => {
    const socket = new RuntimeSocket({ kind: "voice" });
    await socket.opened;
    let taken!: () => void;
    mocks.invoke.mockImplementationOnce(() => new Promise<void>((resolve) => (taken = resolve)));
    socket.send("abc");
    expect(socket.bufferedAmount).toBe(3);
    taken();
    await tick();
    expect(socket.bufferedAmount).toBe(0);
  });

  it("keeps a first message until someone is listening", async () => {
    const socket = new RuntimeSocket({ kind: "voice" });
    hear({ kind: "message", data: '{"type":"ready"}' });
    await socket.opened;
    const heard: unknown[] = [];
    socket.onmessage = ({ data }) => heard.push(data);
    await tick();
    hear({ kind: "message", data: '{"type":"pong"}' });
    expect(heard).toEqual(['{"type":"ready"}', '{"type":"pong"}']);
  });

  it("reports the app's own words when a session can't open, then closes", async () => {
    mocks.invoke.mockImplementation(async () => {
      throw "Voice works only in your own Misty windows.";
    });
    const socket = new RuntimeSocket({ kind: "voice" });
    const events: string[] = [];
    socket.onerror = () => events.push("error");
    socket.onclose = () => events.push("close");
    await expect(socket.opened).rejects.toThrow("Voice works only in your own Misty windows.");
    expect(events).toEqual(["error", "close"]);
  });

  it("closes when the runtime says it has, whoever started it", async () => {
    const socket = new RuntimeSocket({ kind: "voice" });
    const closed = vi.fn();
    socket.onclose = closed;
    await socket.opened;
    socket.close();
    expect(mocks.invoke).toHaveBeenLastCalledWith("agent_runtime_session_close", { id: "session-1" });
    expect(closed).not.toHaveBeenCalled();
    socket.send("dropped");
    expect(sends()).toHaveLength(0);
    hear({ kind: "closed" });
    expect(closed).toHaveBeenCalledOnce();
    hear({ kind: "closed" });
    expect(closed).toHaveBeenCalledOnce();
  });

  it("delivers what was said before the end", async () => {
    const socket = new RuntimeSocket({ kind: "voice" });
    await socket.opened;
    const events: unknown[] = [];
    socket.onmessage = ({ data }) => events.push(data);
    socket.onclose = () => events.push("close");
    hear({ kind: "message", data: "finished" });
    hear({ kind: "closed" });
    expect(events).toEqual(["finished", "close"]);
  });

  it("closes a session that was closed before it finished opening", async () => {
    const socket = new RuntimeSocket({ kind: "voice" });
    socket.close();
    await socket.opened;
    expect(mocks.invoke).toHaveBeenLastCalledWith("agent_runtime_session_close", { id: "session-1" });
  });

  it("treats a send that fails as the socket failing", async () => {
    const socket = new RuntimeSocket({ kind: "voice" });
    await socket.opened;
    const events: string[] = [];
    socket.onerror = () => events.push("error");
    socket.onclose = () => events.push("close");
    mocks.invoke.mockImplementationOnce(async () => {
      throw "This session's messages stopped arriving.";
    });
    socket.send("x");
    await tick();
    expect(events).toEqual(["error", "close"]);
  });
});
