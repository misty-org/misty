import { describe, expect, it, vi } from "vitest";
import { readInvocationStream } from "./invocationStream";

function response(...chunks: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
        controller.close();
      },
    }),
  );
}
const event = (id: string, type: string) => `id: ${id}\ndata: ${JSON.stringify({ id, type })}\n\n`;

describe("AI response stream recovery", () => {
  it("waits for the server cooldown before reconnecting the same invocation", async () => {
    vi.useFakeTimers();
    try {
      const connect = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("blocked", { status: 429, headers: { "Retry-After": "120" } }),
        )
        .mockResolvedValueOnce(response(event("1", "invocation.completed")));
      const pending = readInvocationStream(connect, new AbortController().signal, {
        onEvent: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(119_999);
      expect(connect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(connect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("resumes interrupted work from the last event without duplicating text", async () => {
    const connect = vi
      .fn()
      .mockResolvedValueOnce(response(event("1", "text.delta")))
      .mockResolvedValueOnce(
        response(event("1", "text.delta"), event("2", "invocation.completed")),
      );
    const onEvent = vi.fn();
    await readInvocationStream(connect, new AbortController().signal, { onEvent }, 0);
    expect(connect.mock.calls.map(([id]) => id)).toEqual(["", "1"]);
    expect(onEvent.mock.calls.map(([e]) => e.id)).toEqual(["1", "2"]);
  });
  it("fails explicitly when all streams end before completion", async () => {
    const connect = vi.fn(async () => response(": keep-alive\n\n"));
    await expect(
      readInvocationStream(connect, new AbortController().signal, { onEvent: vi.fn() }, 0),
    ).rejects.toThrow("interrupted");
    expect(connect).toHaveBeenCalledTimes(3);
  });
  it("parses CRLF separators split across network chunks", async () => {
    const onEvent = vi.fn();
    await readInvocationStream(
      async () => response("id: 1\r", '\ndata: {"type":"invocation.completed"}\r', "\n\r", "\n"),
      new AbortController().signal,
      { onEvent },
      0,
    );
    expect(onEvent).toHaveBeenCalledOnce();
  });
  it("does not retry an authorization error", async () => {
    const connect = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    await expect(
      readInvocationStream(connect, new AbortController().signal, { onEvent: vi.fn() }, 0),
    ).rejects.toThrow("401");
    expect(connect).toHaveBeenCalledOnce();
  });
  it("cancels reconnecting when dismissed", async () => {
    const controller = new AbortController();
    const connect = vi.fn(async () => {
      controller.abort();
      return response();
    });
    await readInvocationStream(connect, controller.signal, { onEvent: vi.fn() }, 0);
    expect(connect).toHaveBeenCalledOnce();
  });
  it.each(["invocation.failed", "invocation.canceled"])(
    "settles %s without reconnecting",
    async (type) => {
      const connect = vi.fn(async () => response(event("1", type)));
      await readInvocationStream(connect, new AbortController().signal, { onEvent: vi.fn() }, 0);
      expect(connect).toHaveBeenCalledOnce();
    },
  );
  it("processes trailing terminal event on EOF without trailing newlines", async () => {
    const onEvent = vi.fn();
    const connect = vi.fn(async () =>
      response('id: 1\ndata: {"id":"1","type":"invocation.completed"}'),
    );
    await readInvocationStream(connect, new AbortController().signal, { onEvent }, 0);
    expect(connect).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "invocation.completed" }));
  });
});

describe("idle transport ownership", () => {
  it("bounds connection startup and aborts that attempt before reconnecting", async () => {
    vi.useFakeTimers();
    try {
      let firstSignal!: AbortSignal;
      const connect = vi.fn((_id: string, signal: AbortSignal) => {
        if (!firstSignal) {
          firstSignal = signal;
          return new Promise<Response>(() => {});
        }
        expect(firstSignal.aborted).toBe(true);
        return Promise.resolve(response(event("1", "invocation.completed")));
      });
      const pending = readInvocationStream(
        connect,
        new AbortController().signal,
        { onEvent: vi.fn() },
        0,
        100,
      );
      await vi.advanceTimersByTimeAsync(101);
      await pending;
      expect(connect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps a live approval wait connected while heartbeats continue", async () => {
    vi.useFakeTimers();
    try {
      let source!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          source = c;
        },
      });
      const connect = vi.fn(async () => new Response(stream));
      const onEvent = vi.fn();
      const pending = readInvocationStream(
        connect,
        new AbortController().signal,
        { onEvent },
        0,
        100,
      );
      source.enqueue(new TextEncoder().encode(event("1", "approval.required")));
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(90);
        source.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
      }
      source.enqueue(new TextEncoder().encode(event("2", "invocation.completed")));
      await pending;
      expect(connect).toHaveBeenCalledOnce();
      expect(onEvent).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("reconnects a stalled read using the same event cursor", async () => {
    vi.useFakeTimers();
    try {
      const stalled = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(event("1", "response.delta")));
        },
      });
      const connect = vi
        .fn()
        .mockResolvedValueOnce(new Response(stalled))
        .mockResolvedValueOnce(response(event("2", "invocation.completed")));
      const onEvent = vi.fn();
      const pending = readInvocationStream(
        connect,
        new AbortController().signal,
        { onEvent },
        0,
        100,
      );
      await vi.advanceTimersByTimeAsync(101);
      await pending;
      expect(connect.mock.calls.map(([id]) => id)).toEqual(["", "1"]);
      expect(onEvent).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancels a pending read immediately without reconnecting", async () => {
    const controller = new AbortController();
    const canceled = vi.fn();
    const connect = vi.fn(async () => new Response(new ReadableStream({ cancel: canceled })));
    const pending = readInvocationStream(connect, controller.signal, { onEvent: vi.fn() });
    await Promise.resolve();
    controller.abort();
    await pending;
    expect(canceled).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
  });
});
