import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  http: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  generation: 1,
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  connected: true,
  disconnectDuringRegistration: false,
}));
vi.mock("./client/http", () => ({ httpRequest: mocks.http, httpOutageRemainingMs: () => 0 }));
vi.mock("./deployment/api", () => ({
  readDeploymentScope: () => "native-test",
  resolveApiBase: async () => "https://events.example/api",
}));
vi.mock("./client/session", () => ({
  apiRequestCredentials: () => "include",
  notifyApiSessionInvalid: vi.fn(),
  readApiAuthToken: async () => "",
  readApiSessionGeneration: () => mocks.generation,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
import { subscribeAccountEvents } from "./accountEvents";
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.connected = true;
  mocks.generation = 1;
  mocks.disconnectDuringRegistration = false;
  mocks.listen.mockImplementation(
    async (name: string, callback: (event: { payload: unknown }) => void) => {
      mocks.listeners.set(name, callback);
      if (mocks.disconnectDuringRegistration) mocks.connected = false;
      return () => {
        if (mocks.listeners.get(name) === callback) mocks.listeners.delete(name);
      };
    },
  );
  mocks.invoke.mockImplementation(async () => ({ accountId: "owner", connected: mocks.connected }));
  mocks.http.mockImplementation(
    async (_url, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal?.addEventListener("abort", () => controller.close(), { once: true });
          },
        }),
      ),
  );
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  mocks.listeners.clear();
  vi.clearAllMocks();
});
it("falls back to the authenticated stream when native sync disconnects during registration", async () => {
  mocks.disconnectDuringRegistration = true;
  stop = subscribeAccountEvents("owner", vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.http).toHaveBeenCalledTimes(1);
});
it("recovers a silently stopped native feed using only a local liveness check", async () => {
  const event = vi.fn();
  stop = subscribeAccountEvents("owner", event);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.http).not.toHaveBeenCalled();
  event.mockClear();
  mocks.listeners.get("misty:account-event")?.({ payload: { accountId: "other", topic: "jobs" } });
  expect(event).not.toHaveBeenCalled();
  mocks.listeners.get("misty:account-event")?.({ payload: { accountId: "owner", topic: "jobs" } });
  expect(event).toHaveBeenCalledWith({ topic: "jobs" });
  mocks.connected = false;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.http).toHaveBeenCalledTimes(1);
  expect(event).toHaveBeenCalledWith({ topic: "reset" });
});
it("does not reconnect or deliver events for an obsolete account generation", async () => {
  const event = vi.fn();
  stop = subscribeAccountEvents("owner", event);
  await vi.advanceTimersByTimeAsync(0);
  event.mockClear();
  mocks.generation++;
  mocks.connected = false;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.http).not.toHaveBeenCalled();
  expect(event).not.toHaveBeenCalled();
});

it("does not attach native listeners if stopped while checking feed availability", async () => {
  let ready!: (value: { accountId: string; connected: boolean }) => void;
  mocks.invoke.mockReturnValueOnce(
    new Promise((resolve) => {
      ready = resolve;
    }),
  );
  stop = subscribeAccountEvents("owner", vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  stop();
  ready({ accountId: "owner", connected: true });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.listen).not.toHaveBeenCalled();
  expect(mocks.http).not.toHaveBeenCalled();
});
it("releases a late native listener when its sibling registration fails", async () => {
  const remove = vi.fn();
  let ready!: (value: () => void) => void;
  mocks.listen.mockReturnValueOnce(
    new Promise((resolve) => {
      ready = resolve;
    }),
  );
  mocks.listen.mockImplementationOnce(async () => {
    mocks.connected = false;
    throw new Error("native listener unavailable");
  });
  stop = subscribeAccountEvents("owner", vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  ready(remove);
  await vi.advanceTimersByTimeAsync(0);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(mocks.http).toHaveBeenCalledTimes(1);
});
