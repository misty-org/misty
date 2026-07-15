import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMessageSpans, resetSpacesAccountState, useSpacesStore } from "./useSpacesStore";
import type { SpaceMember, SpaceStudioResource } from "../spaces/types";

const apiMocks = vi.hoisted(() => ({ realtimeTicket: vi.fn() }));

vi.mock("../spaces/api", () => ({
  resolveSpacesApiBase: vi.fn(async () => "http://localhost:8081/api"),
  spacesApi: { realtimeTicket: apiMocks.realtimeTicket },
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string | URL) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const member: SpaceMember = {
  space_id: "space",
  user_id: "user-sam",
  name: "Sam Lee",
  email: "sam@example.com",
  role: "member",
  joined_at: "2026-07-14T00:00:00Z",
  read_message_seq: 0,
};

const agent: SpaceStudioResource = {
  id: "agent-helper",
  space_id: "space",
  creator_user_id: "owner",
  kind: "agent",
  name: "Helper",
  enabled: true,
  version: 1,
  schedules_enabled: false,
  created_at: "2026-07-14T00:00:00Z",
  updated_at: "2026-07-14T00:00:00Z",
};

describe("buildMessageSpans", () => {
  it("stores person and Agent mentions as structured spans", () => {
    expect(buildMessageSpans("Hi @Sam Lee, ask @Helper", [member], [agent])).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", user_id: "user-sam", label: "Sam Lee" },
      { type: "text", text: ", ask " },
      { type: "mention", agent_id: "agent-helper", label: "Helper" },
    ]);
  });

  it("keeps unknown mentions as normal text", () => {
    expect(buildMessageSpans("Hello @Unknown", [member], [agent])).toEqual([{ type: "text", text: "Hello @Unknown" }]);
  });
});

describe("Spaces realtime account lifecycle", () => {
  beforeEach(() => {
    resetSpacesAccountState();
    apiMocks.realtimeTicket.mockReset();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => { values.delete(key); },
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
    });
  });

  afterEach(() => {
    resetSpacesAccountState();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("discards a stale ticket when the active account changes", async () => {
    const oldTicket = deferred<{ ticket: string; expires_in: number }>();
    const newTicket = deferred<{ ticket: string; expires_in: number }>();
    apiMocks.realtimeTicket.mockReturnValueOnce(oldTicket.promise).mockReturnValueOnce(newTicket.promise);

    const oldConnect = useSpacesStore.getState().connectRealtime("old-account");
    resetSpacesAccountState();
    const newConnect = useSpacesStore.getState().connectRealtime("new-account");

    oldTicket.resolve({ ticket: "old-ticket", expires_in: 60 });
    newTicket.resolve({ ticket: "new-ticket", expires_in: 60 });
    await Promise.all([oldConnect, newConnect]);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(String(FakeWebSocket.instances[0].url)).toContain("ticket=new-ticket");
  });

  it("reconnects a failed socket with the active account", async () => {
    vi.useFakeTimers();
    apiMocks.realtimeTicket
      .mockResolvedValueOnce({ ticket: "first-ticket", expires_in: 60 })
      .mockResolvedValueOnce({ ticket: "retry-ticket", expires_in: 60 });

    await useSpacesStore.getState().connectRealtime("active-account");
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].close();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(apiMocks.realtimeTicket).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(String(FakeWebSocket.instances[1].url)).toContain("ticket=retry-ticket");
  });

  it("retries when the websocket handshake hangs", async () => {
    vi.useFakeTimers();
    apiMocks.realtimeTicket
      .mockResolvedValueOnce({ ticket: "hung-ticket", expires_in: 60 })
      .mockResolvedValueOnce({ ticket: "recovered-ticket", expires_in: 60 });

    await useSpacesStore.getState().connectRealtime("active-account");
    await vi.advanceTimersByTimeAsync(14_000);

    expect(apiMocks.realtimeTicket).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(String(FakeWebSocket.instances[1].url)).toContain("ticket=recovered-ticket");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
