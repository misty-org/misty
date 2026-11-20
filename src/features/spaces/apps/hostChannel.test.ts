import { describe, expect, it, vi } from "vitest";
import { createHostChannel } from "./hostChannel";
import type { HostHandlers } from "./hostChannel";
import { HostError, INIT_MESSAGE, PROTOCOL_VERSION } from "./protocol";
import type { Frame } from "./protocol";

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

/** The app's end: what the frame gets, with every frame the host sends it collected. */
function setup(overrides: Partial<HostHandlers> = {}, authorize = vi.fn(async () => {})) {
  const frame = { postMessage: vi.fn() };
  const handlers: HostHandlers = {
    call: vi.fn(async (method: string) => ({ method })),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  };
  const channel = createHostChannel({ frame, authorize, handlers });
  channel.start();
  const [, , transfer] = frame.postMessage.mock.calls[0] as [unknown, string, MessagePort[]];
  const port = transfer[0]!;
  const received: Frame[] = [];
  port.onmessage = (event) => received.push(event.data as Frame);
  return { channel, frame, handlers, authorize, port, received };
}

describe("createHostChannel", () => {
  it("hands the app its port with the protocol version", () => {
    const { frame } = setup();
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
    expect(frame.postMessage.mock.calls[0]![0]).toEqual({
      type: INIT_MESSAGE,
      version: PROTOCOL_VERSION,
    });
    expect(frame.postMessage.mock.calls[0]![1]).toBe("*");
  });

  it("authorizes a call before it runs, then answers it", async () => {
    const { port, received, authorize, handlers } = setup();
    port.postMessage({ t: "req", id: 1, method: "tasks.list" });
    await settle();
    expect(authorize).toHaveBeenCalledWith("call", "tasks.list");
    expect(handlers.call).toHaveBeenCalledWith("tasks.list", undefined);
    expect(received).toEqual([{ t: "res", id: 1, ok: true, result: { method: "tasks.list" } }]);
  });

  it("answers permission_denied and runs nothing when native refuses", async () => {
    const authorize = vi.fn(async () => {
      throw new Error("Planner wasn't approved for files.save.");
    });
    const { port, received, handlers } = setup({}, authorize);
    port.postMessage({ t: "req", id: 2, method: "files.save" });
    await settle();
    expect(handlers.call).not.toHaveBeenCalled();
    expect(received).toEqual([
      {
        t: "res",
        id: 2,
        ok: false,
        error: { code: "permission_denied", message: "Planner wasn't approved for files.save." },
      },
    ]);
  });

  it("keeps a handler's error code and hides other errors' codes as internal", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "a") throw new HostError("conflict", "Changed since.");
      throw new Error("boom");
    });
    const { port, received } = setup({ call });
    port.postMessage({ t: "req", id: 1, method: "a" });
    port.postMessage({ t: "req", id: 2, method: "b" });
    await settle();
    const errors = received.map((frame) =>
      frame.t === "res" && !frame.ok ? frame.error.code : null,
    );
    expect(errors.sort()).toEqual(["conflict", "internal"]);
  });

  it("streams a subscription until the app ends it", async () => {
    let emit: (data: unknown) => void = () => {};
    const stop = vi.fn();
    const subscribe = vi.fn((_topic: string, _params: unknown, send: (data: unknown) => void) => {
      emit = send;
      return stop;
    });
    const { port, received } = setup({ subscribe });
    port.postMessage({ t: "sub", id: 7, topic: "tasks" });
    await settle();
    emit([1]);
    await settle();
    port.postMessage({ t: "unsub", id: 7 });
    await settle();
    emit([2]);
    await settle();
    expect(received).toEqual([{ t: "evt", id: 7, data: [1] }]);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("ends a subscription native refuses, and never starts one ended while it waited", async () => {
    const refuse = vi.fn(async () => {
      throw new Error("no");
    });
    const denied = setup({}, refuse);
    denied.port.postMessage({ t: "sub", id: 1, topic: "room" });
    await settle();
    expect(denied.received).toEqual([
      { t: "end", id: 1, error: { code: "permission_denied", message: "no" } },
    ]);

    let release: () => void = () => {};
    const slow = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const early = setup({}, slow);
    early.port.postMessage({ t: "sub", id: 2, topic: "tasks" });
    await settle();
    early.port.postMessage({ t: "unsub", id: 2 });
    await settle();
    release();
    await settle();
    expect(early.handlers.subscribe).not.toHaveBeenCalled();
    expect(early.received).toEqual([]);
  });

  it("drops frames that aren't well formed", async () => {
    const { port, received, authorize } = setup();
    for (const bad of [
      null,
      5,
      {},
      { t: 1 },
      { t: "req", id: "x", method: "a" },
      { t: "req", id: 1.5, method: "a" },
      { t: "req", id: 1 },
    ]) {
      port.postMessage(bad);
    }
    await settle();
    expect(authorize).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  it("ends every subscription when disposed and sends nothing after", async () => {
    const stop = vi.fn();
    const { channel, port, received } = setup({ subscribe: vi.fn(() => stop) });
    port.postMessage({ t: "sub", id: 1, topic: "tasks" });
    await settle();
    channel.dispose();
    channel.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
    port.postMessage({ t: "req", id: 9, method: "tasks.list" });
    await settle();
    expect(received).toEqual([]);
  });
});

describe("createHostChannel activity", () => {
  it("reports the first frame the app sends, once", async () => {
    const onActivity = vi.fn();
    const frame = { postMessage: vi.fn() };
    const channel = createHostChannel({
      frame,
      authorize: vi.fn(async () => {}),
      handlers: { call: vi.fn(async () => null), subscribe: vi.fn(() => () => {}) },
      onActivity,
    });
    channel.start();
    const port = (frame.postMessage.mock.calls[0] as [unknown, string, MessagePort[]])[2][0]!;
    expect(onActivity).not.toHaveBeenCalled();
    port.postMessage({ t: "req", id: 1, method: "tasks.list" });
    port.postMessage({ t: "req", id: 2, method: "tasks.list" });
    await settle();
    expect(onActivity).toHaveBeenCalledTimes(1);
    channel.dispose();
  });
});
