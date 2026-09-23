import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ http: vi.fn(), generation: 1 }));
vi.mock("./client/http", () => ({ httpRequest: mocks.http }));
vi.mock("./deployment/api", () => ({
  readDeploymentScope: () => "test",
  resolveApiBase: async () => "https://events.example/api",
}));
vi.mock("./client/session", () => ({
  apiRequestCredentials: () => "include",
  readApiAuthToken: async () => "",
  readApiSessionGeneration: () => mocks.generation,
}));
import { observeAccountChanges, subscribeAccountEvents } from "./accountEvents";

const stops: Array<() => void> = [];
afterEach(async () => {
  stops.splice(0).forEach((stop) => stop());
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.generation = 1;
});

function liveStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  mocks.http.mockImplementation(
    async (_url, init: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
            init.signal?.addEventListener(
              "abort",
              () => {
                try {
                  value.close();
                } catch {
                  /* already closed */
                }
              },
              { once: true },
            );
          },
        }),
      ),
  );
  return (data: string) => controller.enqueue(new TextEncoder().encode(data));
}

it("shares one stream, delivers split events, and sends no idle status requests", async () => {
  vi.useFakeTimers();
  const push = liveStream();
  const first = vi.fn(),
    second = vi.fn();
  stops.push(subscribeAccountEvents("account", first), subscribeAccountEvents("account", second));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.http).toHaveBeenCalledTimes(1);
  push('data: {"topic":"runs",');
  push('"id":"run-1"}\r\n\r\n');
  await vi.advanceTimersByTimeAsync(0);
  expect(first).toHaveBeenCalledWith({ topic: "runs", id: "run-1" });
  expect(second).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.http).toHaveBeenCalledTimes(1);
  mocks.generation++;
  push('data: {"topic":"runs","id":"private-old-account"}\n\n');
  await vi.advanceTimersByTimeAsync(0);
  expect(first).toHaveBeenCalledTimes(1);
});

it("honors Retry-After before attempting another connection", async () => {
  vi.useFakeTimers();
  mocks.http.mockResolvedValue(
    new Response("blocked", { status: 429, headers: { "Retry-After": "120" } }),
  );
  stops.push(subscribeAccountEvents("rate-limit", vi.fn()));
  await vi.advanceTimersByTimeAsync(119_999);
  expect(mocks.http).toHaveBeenCalledTimes(1);
  mocks.http.mockResolvedValue(new Response("expired", { status: 401 }));
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.http).toHaveBeenCalledTimes(2);
});

it("coalesces bursts and reconciles again when a notification arrives during a snapshot", async () => {
  vi.useFakeTimers();
  const push = liveStream();
  let finish!: () => void;
  const refresh = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  stops.push(observeAccountChanges("snapshots", ["runs"], refresh));
  await vi.advanceTimersByTimeAsync(250);
  expect(refresh).toHaveBeenCalledTimes(1);
  push('data: {"topic":"runs","id":"1"}\n\ndata: {"topic":"runs","id":"2"}\n\n');
  await vi.advanceTimersByTimeAsync(500);
  expect(refresh).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(250);
  expect(refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("hands the shared stream to a waiting window when its leader closes", async () => {
  vi.useFakeTimers();
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
  const channels = new Set<FakeChannel>();
  class FakeChannel {
    onmessage?: (event: MessageEvent) => void;
    constructor(readonly name: string) {
      channels.add(this);
    }
    postMessage(data: unknown) {
      for (const other of channels)
        if (other !== this && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
    }
    close() {
      channels.delete(this);
    }
  }
  let tail = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, options: { signal: AbortSignal }, callback: () => Promise<void>) => {
        const next = tail.then(() => (options.signal.aborted ? undefined : callback()));
        tail = next.catch(() => {});
        return next;
      },
    },
  });
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  try {
    const push = liveStream();
    const first = vi.fn(),
      second = vi.fn();
    const stopLeader = subscribeAccountEvents("handoff", first);
    stops.push(stopLeader);
    // A fresh module represents another renderer with its own subscription map.
    vi.resetModules();
    const follower = await import("./accountEvents");
    const stopFollower = follower.subscribeAccountEvents("handoff", second);
    stops.push(stopFollower);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.http).toHaveBeenCalledTimes(1);
    push('data: {"topic":"runs","id":"shared"}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ topic: "runs", id: "shared" });
    stopLeader();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.http).toHaveBeenCalledTimes(2);
    stopFollower();
    await vi.advanceTimersByTimeAsync(0);
    expect(channels.size).toBe(0);
  } finally {
    if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
    else Reflect.deleteProperty(navigator, "locks");
    vi.unstubAllGlobals();
  }
});
