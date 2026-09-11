import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ publish: vi.fn(), badge: vi.fn() }));
vi.mock("./nativeNotifications", () => ({
  publishNativeActivity: native.publish,
  syncNativeBadge: native.badge,
}));
vi.mock("@/features/spaces", () => ({
  useSpacesStore: {
    getState: () => ({ loadInbox: async () => {}, markInboxSeen: async () => {} }),
  },
}));
import { useActivityStore } from "./useActivityStore";
import { reportSystemError } from "./systemActivity";
import { activityItemFromSpaceInbox } from "./activityModel";
import type { ActivityItem } from "./types";
const store = () => useActivityStore.getState();
const mention = (id = "mention"): ActivityItem => ({
  id,
  accountId: "one",
  source: "spaces",
  sourceId: id,
  title: "Mention",
  body: "",
  kind: "mention",
  attention: true,
  createdAt: "2026-09-09T12:00:00Z",
  target: { kind: "space-chat", spaceId: "space" },
});
beforeEach(() => {
  localStorage.clear();
  useActivityStore.setState(useActivityStore.getInitialState(), true);
  store().setAccount("one");
  native.publish.mockClear();
  native.badge.mockClear();
});
describe("Activity lifecycle", () => {
  it("limits read and clear to supplied IDs and keeps requests through restart", async () => {
    const request = {
      ...mention("approval"),
      kind: "approval" as const,
      source: "capabilities" as const,
    };
    const entries = [mention("visible"), mention("hidden"), request];
    store().syncSources("one", entries);
    await store().markAllRead(["visible", "approval"]);
    expect(store().allItems.find((item) => item.id === "visible")?.readAt).toBeTruthy();
    expect(store().allItems.find((item) => item.id === "hidden")?.readAt).toBeFalsy();
    expect(store().allItems.find((item) => item.id === "approval")?.readAt).toBeFalsy();
    store().clearHistory(["visible", "approval"]);
    await useActivityStore.persist.rehydrate();
    store().syncSources("one", entries);
    expect(
      store()
        .allItems.map((item) => item.id)
        .sort(),
    ).toEqual(["approval", "hidden"]);
    expect(native.publish).not.toHaveBeenCalled();
  });

  it("keeps requests counted after reading and bulk reading, and resolves only a complete snapshot", async () => {
    const request = {
      ...mention("approval"),
      source: "capabilities" as const,
      kind: "approval" as const,
    };
    store().syncSources("one", [mention(), request]);
    store().openItem("approval");
    await store().markAllRead();
    expect(store().attentionItems.map((item) => item.id)).toEqual(["approval"]);
    store().syncSources("one", []);
    expect(store().attentionCount).toBe(1);
    store().syncSources("one", [], ["capabilities"]);
    expect(store().attentionCount).toBe(0);
    expect(store().allItems.find((item) => item.id === "approval")?.resolvedAt).toBeTruthy();
  });
  it("keeps a confirmed decision resolved even when paginated or stale results follow", () => {
    const request = {
      ...mention("approval"),
      source: "capabilities" as const,
      kind: "approval" as const,
    };
    store().syncSources("one", [request]);
    store().resolveSourceRequest("two", "capabilities", "approval");
    expect(store().attentionCount).toBe(1);
    store().resolveSourceRequest("one", "capabilities", "approval");
    store().syncSources("one", [request]);
    expect(store().attentionCount).toBe(0);
    expect(store().allItems[0].status).toBe("resolved");
  });
  it("separates History checking from Attention and lets later arrivals restore its dot", () => {
    store().syncSources("one", [], ["spaces"]);
    store().syncSources("one", [mention()]);
    expect(store().hasUnseenHistory).toBe(true);
    store().markHistoryChecked();
    expect(store().hasUnseenHistory).toBe(false);
    expect(store().attentionCount).toBe(1);
    store().syncSources("one", [mention(), { ...mention("ordinary"), kind: "message" }]);
    expect(store().hasUnseenHistory).toBe(true);
    expect(store().attentionCount).toBe(1);
  });
  it("muted sources create no ordinary attention, dot, or banners, but retain required requests", () => {
    store().setSourceMuted("space:space", true);
    store().syncSources("one", [], ["spaces"]);
    store().syncSources("one", [mention(), { ...mention("request"), kind: "approval" }]);
    expect(store().attentionItems.map((item) => item.id)).toEqual(["request"]);
    expect(store().allItems).toHaveLength(2);
    expect(store().hasUnseenHistory).toBe(false);
    expect(native.publish).not.toHaveBeenCalled();
  });
  it("updates a job across retries, rejects stale revisions and notifies once per transition", async () => {
    const job = {
      id: "job",
      kind: "failure" as const,
      title: "Export blocked",
      appId: "journal",
      status: "blocked" as const,
      revision: 2,
    };
    const id = store().ingestLocal(job)!;
    store().ingestLocal(job);
    store().openItem(id);
    expect(store().attentionCount).toBe(1);
    store().ingestLocal({ ...job, status: "running", kind: "system", revision: 3 });
    expect(store().attentionCount).toBe(0);
    store().ingestLocal({ ...job, status: "completed", kind: "completion", revision: 4 });
    store().ingestLocal(job);
    expect(store().allItems).toHaveLength(1);
    expect(store().attentionCount).toBe(1);
    expect(native.publish).toHaveBeenCalledTimes(2);
    await useActivityStore.persist.rehydrate();
    store().ingestLocal({ ...job, status: "completed", kind: "completion", revision: 4 });
    expect(native.publish).toHaveBeenCalledTimes(2);
    store().openItem(id);
    expect(store().attentionCount).toBe(0);
  });
  it("keeps diagnostics bounded separately and never evicts pending requests", () => {
    store().ingestLocal({ id: "blocked", kind: "failure", title: "Transfer blocked" });
    for (let i = 0; i < 210; i++)
      reportSystemError({ scope: `app:${i}`, title: "App error", error: "Load failed" });
    expect(store().attentionCount).toBe(1);
    expect(store().localItems.filter((item) => item.visibility === "diagnostic")).toHaveLength(50);
    store().clearDeviceHistory();
    expect(store().attentionCount).toBe(1);
  });
  it("isolates accounts and deployments including local read and mute preferences", () => {
    store().ingestLocal({ id: "job", kind: "completion", title: "Finished" });
    store().setSourceMuted("app:files", true);
    localStorage.setItem("misty:deployment-scope", "another");
    store().setAccount("one");
    expect(store().allItems).toEqual([]);
    expect(store().hasUnseenHistory).toBe(false);
    store().setAccount("two");
    expect(store().allItems).toEqual([]);
    localStorage.removeItem("misty:deployment-scope");
    store().setAccount("one");
    expect(store().attentionCount).toBe(1);
  });
  it("migrates recognizable noise quietly without losing genuine failed work", async () => {
    localStorage.setItem(
      "misty:activity:v1",
      JSON.stringify({
        version: 1,
        state: {
          localItems: [
            {
              ...mention("noise"),
              source: "device",
              sourceId: "system-error:app:chat:tab:1:hash",
              kind: "failure",
            },
            { ...mention("transfer"), source: "device", sourceId: "transfer-1", kind: "failure" },
          ],
          readAtByKey: {},
        },
      }),
    );
    await useActivityStore.persist.rehydrate();
    store().setAccount("one");
    expect(store().allItems.map((item) => item.id)).toEqual(["transfer"]);
    expect(store().hasUnseenHistory).toBe(false);
    expect(native.publish).not.toHaveBeenCalled();
  });
  it("lets legacy action errors be read without inventing pending requests", async () => {
    const oldError: ActivityItem = {
      ...mention("old-error"),
      source: "device",
      sourceId: "system-error:global-search:request:hash",
      kind: "failure",
    };
    const refreshError: ActivityItem = {
      ...oldError,
      id: "poll-error",
      sourceId: "system-error:inbox:connection-1:hash",
    };
    useActivityStore.setState({ localItems: [oldError, refreshError] });
    store().setAccount("one");
    expect(store().attentionItems.map((item) => item.id)).toEqual(["old-error"]);
    store().markRead("old-error");
    expect(store().attentionCount).toBe(0);
    expect(store().allItems.map((item) => item.id)).toEqual(["old-error"]);
    expect(native.publish).not.toHaveBeenCalled();
  });
  it("clears history per account without losing requests or resurrecting items on refresh/restart", async () => {
    store().syncSources("one", [mention(), { ...mention("request"), kind: "approval" }]);
    store().ingestLocal({
      id: "job",
      kind: "completion",
      status: "completed",
      revision: 1,
      title: "Done",
    });
    store().clearHistory();
    expect(store().allItems.map((item) => item.id)).toEqual(["request"]);
    expect(store().attentionCount).toBe(1);
    store().syncSources("one", [mention(), { ...mention("request"), kind: "approval" }]);
    await useActivityStore.persist.rehydrate();
    expect(store().allItems.map((item) => item.id)).toEqual(["request"]);
    store().setAccount("two");
    store().syncSources("two", [{ ...mention(), accountId: "two" }]);
    expect(store().allItems).toHaveLength(1);
    store().setAccount("one");
    store().ingestLocal({ id: "later-job", kind: "completion", title: "New result" });
    expect(store().allItems).toHaveLength(2);
  });
  it("does not treat words in a conversation as operation status", () => {
    const item = activityItemFromSpaceInbox("one", {
      id: 1,
      kind: "unread",
      space_id: "space",
      space_name: "Space",
      created_at: "2026-09-09T12:00:00Z",
      payload: { preview: "I fixed the error that blocked us" },
    } as Parameters<typeof activityItemFromSpaceInbox>[1]);
    expect(item.kind).toBe("message");
  });
});
