import type { Space } from "@/services/spaces/dto/interfaces/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSpacesAccountState, useSpacesStore } from "../../store/useSpacesStore";

const apiMocks = vi.hoisted(() => ({
  realtimeTicket: vi.fn(),
  rename: vi.fn(),
  sendMessage: vi.fn(),
  updateMessage: vi.fn(),
  deleteMessage: vi.fn(),
  removeMember: vi.fn(),
  respondInvite: vi.fn(),
  leave: vi.fn(),
  transfer: vi.fn(),
  delete: vi.fn(),
  saveStudio: vi.fn(),
  deleteStudio: vi.fn(),
  runStudio: vi.fn(),
  snapshot: vi.fn(),
  members: vi.fn(),
  messages: vi.fn(),
  nodes: vi.fn(),
  chatAgents: vi.fn(),
}));

vi.mock("@/services/spaces/api", () => ({
  resolveSpacesApiBase: vi.fn(async () => "http://localhost:8081/api"),
  SpaceRequestError: class SpaceRequestError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message);
      this.name = "SpaceRequestError";
    }
  },
  spacesApi: {
    realtimeTicket: apiMocks.realtimeTicket,
    rename: apiMocks.rename,
    sendMessage: apiMocks.sendMessage,
    updateMessage: apiMocks.updateMessage,
    deleteMessage: apiMocks.deleteMessage,
    removeMember: apiMocks.removeMember,
    respondInvite: apiMocks.respondInvite,
    leave: apiMocks.leave,
    transfer: apiMocks.transfer,
    delete: apiMocks.delete,
    saveStudio: apiMocks.saveStudio,
    deleteStudio: apiMocks.deleteStudio,
    runStudio: apiMocks.runStudio,
    snapshot: apiMocks.snapshot,
    members: apiMocks.members,
    messages: apiMocks.messages,
    nodes: apiMocks.nodes,
    chatAgents: apiMocks.chatAgents,
  },
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

  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("Spaces realtime account lifecycle", () => {
  beforeEach(() => {
    resetSpacesAccountState();
    apiMocks.realtimeTicket.mockReset();
    apiMocks.snapshot.mockReset();
    apiMocks.members.mockReset();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => {
          values.delete(key);
        },
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
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
    apiMocks.realtimeTicket
      .mockReturnValueOnce(oldTicket.promise)
      .mockReturnValueOnce(newTicket.promise);

    const oldConnect = useSpacesStore.getState().connectRealtime("old-account");
    resetSpacesAccountState();
    const newConnect = useSpacesStore.getState().connectRealtime("new-account");

    oldTicket.resolve({ ticket: "old-ticket", expires_in: 60 });
    newTicket.resolve({ ticket: "new-ticket", expires_in: 60 });
    await Promise.all([oldConnect, newConnect]);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(String(FakeWebSocket.instances[0].url)).toContain("ticket=new-ticket");
  });

  it("coalesces concurrent realtime ticket requests for one account", async () => {
    const ticket = deferred<{ ticket: string; expires_in: number }>();
    apiMocks.realtimeTicket.mockReturnValue(ticket.promise);

    const first = useSpacesStore.getState().connectRealtime("active-account");
    const second = useSpacesStore.getState().connectRealtime("active-account");

    expect(apiMocks.realtimeTicket).toHaveBeenCalledTimes(1);
    ticket.resolve({ ticket: "shared-ticket", expires_in: 60 });
    await Promise.all([first, second]);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(String(FakeWebSocket.instances[0].url)).toContain("ticket=shared-ticket");
  });

  it("reconnects a failed socket with the active account", async () => {
    vi.useFakeTimers();
    apiMocks.realtimeTicket
      .mockResolvedValueOnce({ ticket: "first-ticket", expires_in: 60 })
      .mockResolvedValueOnce({ ticket: "retry-ticket", expires_in: 60 });

    await useSpacesStore.getState().connectRealtime("active-account");
    useSpacesStore.setState({ error: "The operation is insecure." });
    FakeWebSocket.instances[0].open();
    expect(useSpacesStore.getState().error).toBeNull();
    FakeWebSocket.instances[0].close();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(apiMocks.realtimeTicket).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(typeof FakeWebSocket.instances[1].url).toBe("string");
    expect(String(FakeWebSocket.instances[1].url)).toContain("ticket=retry-ticket");
  });

  it("retries when the websocket handshake hangs", async () => {
    vi.useFakeTimers();
    apiMocks.realtimeTicket
      .mockResolvedValueOnce({ ticket: "hung-ticket", expires_in: 60 })
      .mockResolvedValueOnce({ ticket: "recovered-ticket", expires_in: 60 });

    await useSpacesStore.getState().connectRealtime("active-account");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(apiMocks.realtimeTicket).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(String(FakeWebSocket.instances[1].url)).toContain("ticket=recovered-ticket");
  });

  it("does not refresh Studio for an own Agent run when Studio visibility is denied", async () => {
    const loadStudio = vi.fn();
    apiMocks.realtimeTicket.mockResolvedValue({ ticket: "permission-ticket", expires_in: 60 });
    useSpacesStore.setState({
      spaces: [
        spaceFixture({ id: "space", permissions: { "agents.run": true, "studio.view": false } }),
      ],
      loadStudio,
    });

    await useSpacesStore.getState().connectRealtime("active-account");
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message({
      type: "event",
      event: spaceEventFixture({ type: "agent.run.started" }),
    });
    await Promise.resolve();

    expect(loadStudio).not.toHaveBeenCalled();
    expect(useSpacesStore.getState().error).toBeNull();
  });

  it.each(["library.upload.ready", "library.item.updated"])(
    "announces %s events to the active Library view",
    async (eventType) => {
      const listener = vi.fn();
      apiMocks.realtimeTicket.mockResolvedValue({ ticket: "library-ticket", expires_in: 60 });
      useSpacesStore.setState({
        spaces: [spaceFixture({ id: "space", permissions: { "library.view": true } })],
      });
      window.addEventListener("misty:space-library-event", listener);

      await useSpacesStore.getState().connectRealtime("active-account");
      FakeWebSocket.instances[0].open();
      FakeWebSocket.instances[0].message({
        type: "event",
        event: spaceEventFixture({ type: eventType }),
      });
      await Promise.resolve();

      expect(listener).toHaveBeenCalledOnce();
      window.removeEventListener("misty:space-library-event", listener);
    },
  );

  it.each(["note.created", "note.projection.updated", "note.deleted"])(
    "announces %s events to the active Notes view",
    async (eventType) => {
      const listener = vi.fn();
      apiMocks.realtimeTicket.mockResolvedValue({ ticket: "note-ticket", expires_in: 60 });
      useSpacesStore.setState({
        spaces: [spaceFixture({ id: "space" })],
      });
      window.addEventListener("misty:space-note-event", listener);

      await useSpacesStore.getState().connectRealtime("active-account");
      FakeWebSocket.instances[0].open();
      FakeWebSocket.instances[0].message({
        type: "event",
        event: spaceEventFixture({ type: eventType }),
      });
      await Promise.resolve();

      expect(listener).toHaveBeenCalledOnce();
      window.removeEventListener("misty:space-note-event", listener);
    },
  );

  it("does not announce Library events when Library visibility is denied", async () => {
    const listener = vi.fn();
    apiMocks.realtimeTicket.mockResolvedValue({ ticket: "library-denied-ticket", expires_in: 60 });
    useSpacesStore.setState({
      spaces: [spaceFixture({ id: "space", permissions: { "library.view": false } })],
    });
    window.addEventListener("misty:space-library-event", listener);

    await useSpacesStore.getState().connectRealtime("active-account");
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message({
      type: "event",
      event: spaceEventFixture({ type: "library.item.updated" }),
    });
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("misty:space-library-event", listener);
  });

  it("does not reload members for realtime events from inaccessible spaces", async () => {
    apiMocks.realtimeTicket.mockResolvedValue({ ticket: "member-ticket", expires_in: 60 });
    apiMocks.snapshot.mockResolvedValue({ spaces: [], invitations: [], limits: null });
    useSpacesStore.setState({
      spaces: [spaceFixture({ id: "space-stale" })],
    });

    await useSpacesStore.getState().connectRealtime("active-account");
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message({
      type: "event",
      event: spaceEventFixture({ space_id: "space-stale", type: "member.left" }),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(apiMocks.snapshot).toHaveBeenCalledOnce();
    expect(apiMocks.members).not.toHaveBeenCalled();
    expect(useSpacesStore.getState().error).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function spaceFixture(patch: Partial<Space> = {}): Space {
  return {
    id: "space-default",
    owner_user_id: "owner",
    name: "Default space",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: false,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
    ...patch,
  };
}

function spaceEventFixture(patch: Record<string, unknown> = {}) {
  return {
    id: 1,
    space_id: "space",
    type: "agent.run.started",
    actor_user_id: "active-account",
    entity_id: "run-1",
    payload: {},
    created_at: "2026-07-15T00:00:00Z",
    ...patch,
  };
}
