import { describe, expect, it, vi } from "vitest";
import { createHostChannel } from "./host_channel";
import type { HostHandlers } from "./host_channel";
import { HostError, INIT_MESSAGE, PROTOCOL_VERSION } from "./protocol";
import type { Frame } from "./protocol";

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

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
  it("hands the app its port with every protocol version it speaks", () => {
    const { frame } = setup();
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
    expect(frame.postMessage.mock.calls[0]![0]).toEqual({
      type: INIT_MESSAGE,
      version: PROTOCOL_VERSION,
      versions: [PROTOCOL_VERSION],
    });
    expect(frame.postMessage.mock.calls[0]![1]).toBe("*");
  });

  it("authorizes a call before it runs, then answers it", async () => {
    const { port, received, authorize, handlers } = setup();
    port.postMessage({ t: "req", id: 1, method: "files.list" });
    await settle();
    expect(authorize).toHaveBeenCalledWith("call", "files.list");
    expect(handlers.call).toHaveBeenCalledWith("files.list", undefined);
    expect(received).toEqual([{ t: "res", id: 1, ok: true, result: { method: "files.list" } }]);
  });

  it("answers permission_denied and runs nothing when native refuses", async () => {
    const authorize = vi.fn(async () => {
      throw new Error("Sketch wasn't approved for files.save.");
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
        error: { code: "permission_denied", message: "Sketch wasn't approved for files.save." },
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
    port.postMessage({ t: "sub", id: 7, topic: "files.watch" });
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

  it("ends a subscription the handler stops on its own, with why, and stops it once", async () => {
    let finish: (error?: unknown) => void = () => {};
    let emit: (data: unknown) => void = () => {};
    const stop = vi.fn();
    const subscribe = vi.fn(
      (
        _topic: string,
        _params: unknown,
        send: (data: unknown) => void,
        end: (error?: unknown) => void,
      ) => {
        emit = send;
        finish = end;
        return stop;
      },
    );
    const { port, received } = setup({ subscribe });
    port.postMessage({ t: "sub", id: 4, topic: "room" });
    await settle();
    emit("first");
    finish(new HostError("not_found", "The room was deleted."));
    finish(new HostError("internal", "again"));
    emit("late");
    await settle();
    port.postMessage({ t: "unsub", id: 4 });
    await settle();
    expect(received).toEqual([
      { t: "evt", id: 4, data: "first" },
      { t: "end", id: 4, error: { code: "not_found", message: "The room was deleted." } },
    ]);
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
    early.port.postMessage({ t: "sub", id: 2, topic: "files.watch" });
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
    port.postMessage({ t: "sub", id: 1, topic: "files.watch" });
    await settle();
    channel.dispose();
    channel.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
    port.postMessage({ t: "req", id: 9, method: "files.list" });
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
    port.postMessage({ t: "req", id: 1, method: "files.list" });
    port.postMessage({ t: "req", id: 2, method: "files.list" });
    await settle();
    expect(onActivity).toHaveBeenCalledTimes(1);
    channel.dispose();
  });
});
