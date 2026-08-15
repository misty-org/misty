import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "./types";

const mocks = vi.hoisted(() => ({
  markInboxSeen: vi.fn(async () => undefined),
  loadInbox: vi.fn(async () => undefined),
  publishNativeActivity: vi.fn(async () => true),
  syncNativeBadge: vi.fn(async () => undefined),
}));

vi.mock("@/features/spaces", () => ({
  useSpacesStore: {
    getState: () => ({
      markInboxSeen: mocks.markInboxSeen,
      loadInbox: mocks.loadInbox,
    }),
  },
}));

vi.mock("./nativeNotifications", () => ({
  publishNativeActivity: mocks.publishNativeActivity,
  syncNativeBadge: mocks.syncNativeBadge,
}));

import { useActivityStore } from "./useActivityStore";

describe("useActivityStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useActivityStore.persist.clearStorage();
    useActivityStore.setState({
      accountId: "",
      sourceItems: [],
      localItems: [],
      readAtByKey: {},
      knownSourceIdsByAccount: {},
      baselinedAccounts: [],
      allItems: [],
      attentionItems: [],
      attentionCount: 0,
      loading: false,
      offline: false,
      error: null,
    });
    mocks.markInboxSeen.mockClear();
    mocks.loadInbox.mockClear();
    mocks.publishNativeActivity.mockClear();
    mocks.syncNativeBadge.mockClear();
  });

  it("counts only unread attention items and does not read them when listed", () => {
    const store = useActivityStore.getState();
    store.setAccount("account-1");
    store.syncSources("account-1", [
      itemFixture({ id: "spaces:1", kind: "message", attention: false }),
      itemFixture({ id: "spaces:2", kind: "mention", attention: true }),
      itemFixture({
        id: "spaces:3",
        kind: "failure",
        attention: true,
        readAt: "2026-08-08T12:00:00Z",
      }),
    ]);

    expect(useActivityStore.getState().allItems).toHaveLength(3);
    expect(useActivityStore.getState().attentionCount).toBe(1);
    expect(
      useActivityStore.getState().allItems.find((item) => item.id === "spaces:2")?.readAt,
    ).toBeUndefined();
  });

  it("marks one item locally when opened and returns its typed target", () => {
    useActivityStore.getState().setAccount("account-1");
    useActivityStore.getState().syncSources("account-1", [itemFixture()]);

    const target = useActivityStore.getState().openItem("spaces:1");

    expect(target).toEqual({ kind: "space-chat", spaceId: "space-1", messageId: "message-1" });
    expect(useActivityStore.getState().attentionCount).toBe(0);
    expect(useActivityStore.getState().allItems[0].readAt).toBeTruthy();
  });

  it("marks every visible item read and uses the existing server endpoint", async () => {
    useActivityStore.getState().setAccount("account-1");
    useActivityStore
      .getState()
      .syncSources("account-1", [itemFixture(), itemFixture({ id: "spaces:2", sourceId: "2" })]);

    await useActivityStore.getState().markAllRead();

    expect(useActivityStore.getState().attentionCount).toBe(0);
    expect(useActivityStore.getState().allItems.every((item) => item.readAt)).toBe(true);
    expect(mocks.markInboxSeen).toHaveBeenCalledTimes(1);
    expect(mocks.syncNativeBadge).toHaveBeenLastCalledWith(0);
  });

  it("deduplicates reload delivery and only notifies for new post-baseline attention", () => {
    useActivityStore.getState().setAccount("account-1");
    const first = itemFixture();
    useActivityStore.getState().syncSources("account-1", [first]);
    useActivityStore.getState().syncSources("account-1", [first]);
    expect(mocks.publishNativeActivity).not.toHaveBeenCalled();

    const second = itemFixture({ id: "spaces:2", sourceId: "2" });
    useActivityStore.getState().syncSources("account-1", [second, first]);
    useActivityStore.getState().syncSources("account-1", [second, first]);

    expect(mocks.publishNativeActivity).toHaveBeenCalledTimes(1);
    expect(mocks.publishNativeActivity).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spaces:2" }),
    );
  });

  it("restores account-local operation history without leaking it across accounts", () => {
    useActivityStore.getState().setAccount("account-1");
    useActivityStore.getState().ingestLocal({
      id: "transfer-1",
      kind: "failure",
      title: "Transfer needs attention",
      notify: false,
    });
    expect(useActivityStore.getState().attentionCount).toBe(1);

    useActivityStore.getState().setAccount("account-2");
    expect(useActivityStore.getState().allItems).toEqual([]);

    useActivityStore.getState().setAccount("account-1");
    expect(useActivityStore.getState().allItems.map((item) => item.id)).toEqual([
      "device:account-1:transfer-1",
    ]);
  });

  it("restores persisted device history after rehydration", async () => {
    useActivityStore.getState().setAccount("account-1");
    useActivityStore.getState().ingestLocal({
      id: "reminder-1",
      kind: "reminder",
      title: "Planner reminder",
      notify: false,
    });
    const persisted = localStorage.getItem("misty:activity:v1");
    useActivityStore.setState({ accountId: "", localItems: [], allItems: [], attentionItems: [] });
    if (persisted) localStorage.setItem("misty:activity:v1", persisted);

    await useActivityStore.persist.rehydrate();
    useActivityStore.getState().setAccount("account-1");

    expect(useActivityStore.getState().allItems[0]).toMatchObject({
      id: "device:account-1:reminder-1",
      kind: "reminder",
      attention: true,
    });
  });

  it("clears the native badge when the active account logs out", () => {
    useActivityStore.getState().setAccount("account-1");
    useActivityStore.getState().syncSources("account-1", [itemFixture()]);
    mocks.syncNativeBadge.mockClear();

    useActivityStore.getState().setAccount("");

    expect(useActivityStore.getState().attentionCount).toBe(0);
    expect(mocks.syncNativeBadge).toHaveBeenCalledWith(0);
  });

  it("bounds device history to 200 items", () => {
    useActivityStore.getState().setAccount("account-1");
    for (let index = 0; index < 205; index += 1) {
      useActivityStore.getState().ingestLocal({
        id: `operation-${index}`,
        kind: "completion",
        title: `Operation ${index}`,
        createdAt: new Date(Date.UTC(2026, 7, 8, 0, 0, index)).toISOString(),
        notify: false,
      });
    }
    expect(useActivityStore.getState().localItems).toHaveLength(200);
    expect(useActivityStore.getState().allItems).toHaveLength(200);
  });
});

function itemFixture(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "spaces:1",
    accountId: "account-1",
    source: "spaces",
    sourceId: "1",
    kind: "mention",
    title: "Alex mentioned you",
    body: "Please review this.",
    createdAt: "2026-08-08T12:00:00Z",
    attention: true,
    target: { kind: "space-chat", spaceId: "space-1", messageId: "message-1" },
    ...overrides,
  };
}
