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
  it("resumes interrupted work from the last event without duplicating text", async () => {
    const connect = vi
      .fn()
      .mockResolvedValueOnce(response(event("1", "text.delta")))
      .mockResolvedValueOnce(
        response(event("1", "text.delta"), event("2", "invocation.completed")),
      );
    const onEvent = vi.fn();
    await readInvocationStream(connect, new AbortController().signal, { onEvent }, 0);
    expect(connect.mock.calls).toEqual([[""], ["1"]]);
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
});
