import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMessageSpans,
  resetSpacesAccountState,
  useSpacesStore,
} from "@/stores/spaces/useSpacesStore";
import type {
  Space,
  SpaceMember,
  SpaceMessage,
  SpaceStudioResource,
} from "@/models/interfaces/features/spaces/types";

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
}));

vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({
  resolveSpacesApiBase: vi.fn(async () => "http://localhost:8081/api"),
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
    expect(buildMessageSpans("Hello @Unknown", [member], [agent])).toEqual([
      { type: "text", text: "Hello @Unknown" },
    ]);
  });

  it("keeps unsupported shared @Mika text literal instead of sending an invalid Agent span", () => {
    expect(buildMessageSpans("@Mika summarize these files", [member], [agent])).toEqual([
      { type: "text", text: "@Mika summarize these files" },
    ]);
  });

  it("requires a picker selection when Agent names are ambiguous", () => {
    const duplicate = { ...agent, id: "agent-helper-two" };
    expect(buildMessageSpans("@Helper help", [], [agent, duplicate])).toEqual([
      { type: "text", text: "@Helper help" },
    ]);
    expect(
      buildMessageSpans("@Helper help", [], [agent, duplicate], {
        helper: "agent-helper-two",
      }),
    ).toEqual([
      { type: "mention", agent_id: "agent-helper-two", label: "Helper" },
      { type: "text", text: " help" },
    ]);
  });
});

describe("Space loading access boundary", () => {
  beforeEach(() => {
    resetSpacesAccountState();
    apiMocks.snapshot.mockReset();
    apiMocks.members.mockReset();
    apiMocks.messages.mockReset();
    apiMocks.nodes.mockReset();
  });

  afterEach(() => resetSpacesAccountState());

  it("does not fan out protected requests when a fresh snapshot omits the Space", async () => {
    apiMocks.snapshot.mockResolvedValue({ spaces: [], invitations: [], limits: null });
    useSpacesStore.setState({
      membersBySpace: { revoked: [member] },
      messagesBySpace: { revoked: [messageFixture({ space_id: "revoked" })] },
      nodesBySpace: { revoked: [] },
    });

    await useSpacesStore.getState().loadSpace("revoked");

    expect(apiMocks.members).not.toHaveBeenCalled();
    expect(apiMocks.messages).not.toHaveBeenCalled();
    expect(apiMocks.nodes).not.toHaveBeenCalled();
    expect(useSpacesStore.getState()).toMatchObject({
      snapshotReady: true,
      membersBySpace: {},
      messagesBySpace: {},
      nodesBySpace: {},
    });
  });

  it("fails closed when refreshing a stale Space snapshot fails", async () => {
    apiMocks.snapshot.mockRejectedValue(new Error("offline"));
    useSpacesStore.setState({ spaces: [spaceFixture({ id: "stale" })] });

    await useSpacesStore.getState().loadSpace("stale");

    expect(apiMocks.members).not.toHaveBeenCalled();
    expect(apiMocks.messages).not.toHaveBeenCalled();
    expect(apiMocks.nodes).not.toHaveBeenCalled();
    expect(useSpacesStore.getState()).toMatchObject({
      snapshotReady: false,
      error: "offline",
    });
  });
});

describe("Spaces mutations", () => {
  beforeEach(() => {
    resetSpacesAccountState();
    apiMocks.rename.mockReset();
    apiMocks.sendMessage.mockReset();
    apiMocks.updateMessage.mockReset();
    apiMocks.deleteMessage.mockReset();
    apiMocks.removeMember.mockReset();
    apiMocks.respondInvite.mockReset();
    apiMocks.leave.mockReset();
    apiMocks.transfer.mockReset();
    apiMocks.delete.mockReset();
    apiMocks.saveStudio.mockReset();
    apiMocks.deleteStudio.mockReset();
    apiMocks.runStudio.mockReset();
  });

  afterEach(() => resetSpacesAccountState());

  it("replaces the renamed default Space in the snapshot", async () => {
    const original = spaceFixture({ name: "Default space" });
    const renamed = { ...original, name: "Home base", updated_at: "2026-07-15T01:00:00Z" };
    apiMocks.rename.mockResolvedValue(renamed);
    useSpacesStore.setState({ spaces: [original] });

    await useSpacesStore.getState().renameSpace(original.id, renamed.name);

    expect(apiMocks.rename).toHaveBeenCalledWith(original.id, renamed.name);
    expect(useSpacesStore.getState().spaces).toEqual([renamed]);
  });

  it("replaces a message with the edited server response", async () => {
    const original = messageFixture({ content: [{ type: "text", text: "Before" }] });
    const edited = {
      ...original,
      content: [{ type: "text" as const, text: "After" }],
      edited_at: "2026-07-15T01:00:00Z",
    };
    apiMocks.updateMessage.mockResolvedValue(edited);
    useSpacesStore.setState({ messagesBySpace: { [original.space_id]: [original] } });

    await useSpacesStore.getState().updateMessage(original.space_id, original.id, "After");

    expect(useSpacesStore.getState().messagesBySpace[original.space_id]).toEqual([edited]);
  });

  it("sends accessible Agent mentions as structured spans", async () => {
    const sent = messageFixture({
      content: [{ type: "mention", agent_id: agent.id, label: agent.name }],
    });
    apiMocks.sendMessage.mockResolvedValue({
      message: sent,
      agent_replies: [],
      agent_failures: [
        {
          agent_id: agent.id,
          code: "integration_required",
          message: "The run needs a required Space integration before it can start.",
        },
      ],
    });
    useSpacesStore.setState({ agentsBySpace: { [sent.space_id]: [agent] } });

    await useSpacesStore.getState().sendMessage(sent.space_id, `@${agent.name}`);

    expect(apiMocks.sendMessage.mock.calls[0]?.[1]).toEqual([
      { type: "mention", agent_id: agent.id, label: agent.name },
    ]);
    expect(useSpacesStore.getState().messagesBySpace[sent.space_id]).toEqual([sent]);
    expect(useSpacesStore.getState().error).toBeNull();
  });

  // Regression coverage: these actions previously had no error handling at all,
  // so a failed request left `error` untouched and the UI's error banner (which
  // every caller's own comments assumed would show something) stayed empty.
  it.each([
    ["deleteMessage", () => useSpacesStore.getState().deleteMessage("space-default", "message-1")],
    ["removeMember", () => useSpacesStore.getState().removeMember("space-default", "user-sam")],
    ["respondInvite", () => useSpacesStore.getState().respondInvite("invite-1", true)],
    ["leaveSpace", () => useSpacesStore.getState().leaveSpace("space-default")],
    ["transferOwner", () => useSpacesStore.getState().transferOwner("space-default", "user-sam")],
    ["deleteSpace", () => useSpacesStore.getState().deleteSpace("space-default", "Default space")],
    [
      "saveStudio",
      () =>
        useSpacesStore
          .getState()
          .saveStudio("space-default", "agents", { name: "Helper" } as never),
    ],
    [
      "deleteStudio",
      () => useSpacesStore.getState().deleteStudio("space-default", "agents", "agent-helper"),
    ],
    [
      "runStudio",
      () => useSpacesStore.getState().runStudio("space-default", "agents", "agent-helper"),
    ],
  ] as const)(
    "%s records the failure on the shared store error and rethrows",
    async (name, run) => {
      const failure = new Error(`${name} failed`);
      apiMocks.deleteMessage.mockRejectedValue(failure);
      apiMocks.removeMember.mockRejectedValue(failure);
      apiMocks.respondInvite.mockRejectedValue(failure);
      apiMocks.leave.mockRejectedValue(failure);
      apiMocks.transfer.mockRejectedValue(failure);
      apiMocks.delete.mockRejectedValue(failure);
      apiMocks.saveStudio.mockRejectedValue(failure);
      apiMocks.deleteStudio.mockRejectedValue(failure);
      apiMocks.runStudio.mockRejectedValue(failure);

      await expect(run()).rejects.toThrow(`${name} failed`);

      expect(useSpacesStore.getState().error).toBe(`${name} failed`);
    },
  );

  it("does not leave a stale error from a previous failure once a call succeeds", async () => {
    apiMocks.leave.mockRejectedValueOnce(new Error("network blip"));
    await expect(useSpacesStore.getState().leaveSpace("space-default")).rejects.toThrow();
    expect(useSpacesStore.getState().error).toBe("network blip");

    apiMocks.leave.mockResolvedValueOnce(undefined);
    apiMocks.snapshot.mockResolvedValue({ spaces: [], invitations: [], limits: null });
    await useSpacesStore.getState().leaveSpace("space-default");

    expect(useSpacesStore.getState().error).toBeNull();
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

  it("reconnects a failed socket with the active account", async () => {
    vi.useFakeTimers();
    apiMocks.realtimeTicket
      .mockResolvedValueOnce({ ticket: "first-ticket", expires_in: 60 })
      .mockResolvedValueOnce({ ticket: "retry-ticket", expires_in: 60 });

    await useSpacesStore.getState().connectRealtime("active-account");
    FakeWebSocket.instances[0].open();
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
    is_personal: true,
    is_shared: false,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
    ...patch,
  };
}

function messageFixture(patch: Partial<SpaceMessage> = {}): SpaceMessage {
  return {
    seq: 1,
    id: "message-1",
    space_id: "space-default",
    sender_user_id: "owner",
    sender_name: "Owner",
    sender_kind: "person",
    content: [{ type: "text", text: "Before" }],
    file_node_ids: [],
    created_at: "2026-07-15T00:00:00Z",
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
