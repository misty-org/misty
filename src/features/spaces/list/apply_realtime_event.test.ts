import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceEvent, SpaceMessage } from "../api/dto/entities";
import { readRealtimeCursor, resetRealtimeCursors } from "../api/realtime_cursor";
import { applyRealtimeEventSafely } from "./apply_realtime_event";
import { resetCoalescedReloads } from "./coalesced_reload";
import { setSpacesSnapshotQueuedCheck } from "./spaces_snapshot_freshness";
import { spaceReadEvent } from "./spaces_resync";
import type { SpacesStore } from "./spaces_store_types";

const conversations = vi.hoisted(() => ({
  applySpaceChatReadMarker: vi.fn(),
  reloadSpaceConversations: vi.fn(async () => undefined),
  reloadSpaceConversationsForMessage: vi.fn(async () => undefined),
}));

vi.mock("../chat/space_conversations_resource", () => conversations);

let accounts = 0;

function event(id: number, type: string, payload: Record<string, unknown> = {}): SpaceEvent {
  return { id, space_id: "space-1", type, payload, created_at: new Date().toISOString() };
}

function harness(accountId: string, state: Partial<SpacesStore>) {
  const store = { messagesBySpace: {}, nodesBySpace: {}, ...state } as SpacesStore;
  const scope = {
    currentAccountId: () => accountId,
    accountGeneration: () => 0,
    resync: vi.fn(async () => undefined),
    resyncAfterFailure: vi.fn(async () => undefined),
  };
  const set = vi.fn();
  return { get: () => store, set, scope };
}

describe("applying realtime events", () => {
  beforeEach(() => {
    resetRealtimeCursors();
    resetCoalescedReloads();
    Object.values(conversations).forEach((mock) => mock.mockClear());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on an apply that never finishes, resyncs once and moves the cursor on", async () => {
    vi.useFakeTimers();
    const accountId = `apply-bound-${(accounts += 1)}`;
    const { get, set, scope } = harness(accountId, {
      nodesBySpace: { "space-1": [] },
      loadNodes: vi.fn(() => new Promise<void>(() => {})),
    } as Partial<SpacesStore>);

    applyRealtimeEventSafely(event(41, "node.updated"), accountId, get, set, scope);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(readRealtimeCursor(accountId)).toBe(0);
    expect(scope.resyncAfterFailure).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(scope.resyncAfterFailure).toHaveBeenCalledTimes(1);
    expect(scope.resync).not.toHaveBeenCalled();
    expect(readRealtimeCursor(accountId)).toBe(41);
  });

  it("applies the person's own read marker locally instead of reloading the lists", async () => {
    const accountId = `apply-read-${(accounts += 1)}`;
    const newest = { id: "m2", seq: 7 } as SpaceMessage;
    const { get, set, scope } = harness(accountId, {
      messagesBySpace: { "space-1": [{ id: "m1", seq: 6 } as SpaceMessage, newest] },
    });
    const heard: unknown[] = [];
    const listen = (raised: Event) => heard.push((raised as CustomEvent).detail);
    window.addEventListener(spaceReadEvent, listen);

    applyRealtimeEventSafely(
      { ...event(52, "read.updated", { conversation_id: "", seq: 7 }), actor_user_id: accountId },
      accountId,
      get,
      set,
      scope,
    );
    applyRealtimeEventSafely(
      { ...event(53, "read.updated", { conversation_id: "", seq: 6 }), actor_user_id: accountId },
      accountId,
      get,
      set,
      scope,
    );
    await Promise.resolve();
    window.removeEventListener(spaceReadEvent, listen);

    expect(conversations.applySpaceChatReadMarker).toHaveBeenNthCalledWith(1, "space-1", "", true);
    expect(conversations.applySpaceChatReadMarker).toHaveBeenNthCalledWith(2, "space-1", "", false);
    expect(conversations.reloadSpaceConversationsForMessage).not.toHaveBeenCalled();
    expect(heard).toMatchObject([{ caughtUp: true }, { caughtUp: false }]);
  });

  it("reloads the lists for a read it can't check against the newest message it holds", async () => {
    const accountId = `apply-unknown-read-${(accounts += 1)}`;
    const { get, set, scope } = harness(accountId, {});

    applyRealtimeEventSafely(
      { ...event(71, "read.updated", { conversation_id: "group", seq: 2 }), actor_user_id: accountId },
      accountId,
      get,
      set,
      scope,
    );
    applyRealtimeEventSafely(
      { ...event(72, "read.updated", { conversation_id: "", seq: 2 }), actor_user_id: accountId },
      accountId,
      get,
      set,
      scope,
    );
    await Promise.resolve();

    expect(conversations.applySpaceChatReadMarker).toHaveBeenNthCalledWith(
      1,
      "space-1",
      "group",
      false,
    );
    expect(conversations.applySpaceChatReadMarker).toHaveBeenNthCalledWith(2, "space-1", "", false);
  });

  it("counts a Space list reload queued behind a cooldown as done", async () => {
    const accountId = `apply-queued-${(accounts += 1)}`;
    setSpacesSnapshotQueuedCheck(() => true);
    try {
      const { get, set, scope } = harness(accountId, {
        spaces: [],
        load: vi.fn(async () => undefined),
      } as Partial<SpacesStore>);

      applyRealtimeEventSafely(event(81, "space.updated"), accountId, get, set, scope);
      await new Promise((done) => setTimeout(done, 0));

      expect(scope.resyncAfterFailure).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(readRealtimeCursor(accountId)).toBe(81);
    } finally {
      setSpacesSnapshotQueuedCheck(() => false);
    }
  });

  it("leaves channel lists alone for a read inside a thread", async () => {
    const accountId = `apply-thread-read-${(accounts += 1)}`;
    const { get, set, scope } = harness(accountId, {});

    applyRealtimeEventSafely(
      {
        ...event(61, "read.updated", { conversation_id: "", seq: 3, thread_root_id: "root" }),
        actor_user_id: accountId,
      },
      accountId,
      get,
      set,
      scope,
    );
    await Promise.resolve();

    expect(conversations.applySpaceChatReadMarker).not.toHaveBeenCalled();
    expect(conversations.reloadSpaceConversationsForMessage).not.toHaveBeenCalled();
  });
});
