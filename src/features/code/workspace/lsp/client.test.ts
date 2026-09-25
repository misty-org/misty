import { afterEach, expect, it, vi } from "vitest";
import { LspClient, pathToUri, uriToPath, type CodeLspTransport, type LspMessage } from "./client";
function fixture() {
  let receive!: (message: LspMessage) => void;
  let exit!: (reason: string) => void;
  const remove = vi.fn();
  const transport = {
    start: vi.fn(async () => "session-a"),
    send: vi.fn(async (_id: string, _message: LspMessage) => undefined),
    stop: vi.fn(async () => undefined),
    subscribe: vi.fn(
      async (_id: string, message: typeof receive, exited: typeof exit): Promise<() => void> => {
        receive = message;
        exit = exited;
        return remove;
      },
    ),
  } satisfies CodeLspTransport;
  const client = new LspClient("typescript", "/chosen/project", transport, {
    requestTimeoutMs: 100,
  });
  const initialize = async () => {
    const ready = client.ensureStarted();
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalled());
    const request = transport.send.mock.calls[0]![1];
    expect(request.method).toBe("initialize");
    expect(transport.send.mock.calls.some(([, message]) => message.method === "initialized")).toBe(
      false,
    );
    receive({ jsonrpc: "2.0", id: request.id, result: { capabilities: {} } });
    await ready;
  };
  return {
    client,
    transport,
    remove,
    initialize,
    receive: (message: LspMessage) => receive(message),
    exit: (reason: string) => exit(reason),
  };
}
afterEach(() => vi.useRealTimers());
it("waits for initialize before initialized and routes server requests independently of client request IDs", async () => {
  const f = fixture();
  try {
    await f.initialize();
    expect(f.client.isRunning()).toBe(true);
    const handler = vi.fn();
    f.client.onMessage(handler);
    const response = f.client.request("textDocument/hover", {});
    await vi.waitFor(() => expect(f.transport.send.mock.calls).toHaveLength(3));
    const id = f.transport.send.mock.calls[2]![1].id;
    f.receive({ jsonrpc: "2.0", id, method: "workspace/configuration", params: {} });
    expect(handler).toHaveBeenCalledTimes(1);
    f.receive({ jsonrpc: "2.0", id, result: { contents: "Hover" } });
    await expect(response).resolves.toEqual({ contents: "Hover" });
  } finally {
    await f.client.dispose();
  }
  expect(f.remove).toHaveBeenCalledOnce();
  expect(f.transport.stop).toHaveBeenCalledOnce();
});
it("rejects pending requests on exit and does not restart after disposal", async () => {
  const f = fixture();
  await f.initialize();
  const request = f.client.request("textDocument/hover", {});
  const rejected = expect(request).rejects.toThrow("stopped");
  await vi.waitFor(() => expect(f.transport.send.mock.calls).toHaveLength(3));
  f.exit("Server stopped");
  await rejected;
  await expect(f.client.ensureStarted()).rejects.toThrow("closed");
  await f.client.dispose();
  expect(f.transport.start).toHaveBeenCalledOnce();
  expect(f.transport.stop).toHaveBeenCalledOnce();
});
it("closes during native startup and stops a late session without subscribing", async () => {
  const f = fixture();
  let finish!: (id: string) => void;
  f.transport.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const starting = f.client.ensureStarted();
  const rejected = expect(starting).rejects.toThrow("closed");
  await f.client.dispose();
  await rejected;
  finish("late-session");
  await vi.waitFor(() => expect(f.transport.stop).toHaveBeenCalledWith("late-session"));
  expect(f.transport.subscribe).not.toHaveBeenCalled();
});
it("removes a subscription that finishes after closure", async () => {
  const f = fixture();
  let finish!: (remove: () => void) => void;
  f.transport.subscribe.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const starting = f.client.ensureStarted();
  const rejected = expect(starting).rejects.toThrow("closed");
  await vi.waitFor(() => expect(f.transport.subscribe).toHaveBeenCalled());
  await f.client.dispose();
  await rejected;
  finish(f.remove);
  await vi.waitFor(() => expect(f.remove).toHaveBeenCalledOnce());
  expect(f.transport.send).not.toHaveBeenCalled();
});
it("bounds unanswered requests and cleans up failed initialization", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const starting = f.client.ensureStarted();
  const rejected = expect(starting).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(101);
  await rejected;
  expect(f.transport.stop).toHaveBeenCalledOnce();
  expect(f.remove).toHaveBeenCalledOnce();
});
it("round trips local file names containing URI punctuation and leaves remote file authorities alone", () => {
  for (const path of ["/chosen/a #?.ts", "/chosen/東京 %23.ts"])
    expect(uriToPath(pathToUri(path))).toBe(path);
  expect(uriToPath("file://another-machine/project.ts")).toBe("file://another-machine/project.ts");
});

it("does not dispatch a queued request after the view closes", async () => {
  const f = fixture();
  await f.initialize();
  const request = f.client.request("textDocument/hover", {});
  const rejected = expect(request).rejects.toThrow("closed");
  await Promise.resolve();
  await f.client.dispose();
  await rejected;
  expect(f.transport.send.mock.calls.map(([, message]) => message.method)).toEqual([
    "initialize",
    "initialized",
  ]);
});
it("stops the owned process even if subscription cleanup throws", async () => {
  const f = fixture();
  await f.initialize();
  f.remove.mockImplementation(() => {
    throw new Error("Listener cleanup failed");
  });
  await expect(f.client.dispose()).rejects.toThrow("Listener cleanup failed");
  expect(f.transport.stop).toHaveBeenCalledOnce();
  expect(f.client.isRunning()).toBe(false);
});
