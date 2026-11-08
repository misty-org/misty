import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** Each window's own record, the record from before windows had ids, and closed windows' tabs. */
const native = vi.hoisted(() => ({
  values: new Map<string, { revision: number; value: string }>(),
  fail: false,
  orphans: [] as string[],
  records: new Map<string, Map<string, unknown>>(),
  refuseRecords: false,
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
  invoke: vi.fn(),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/app/shell/useAppStore", () => ({
  useAppStore: { getState: () => ({ setError: vi.fn() }) },
}));
vi.mock("@/api/client/session", () => ({ readApiSessionGeneration: () => 1 }));
vi.mock("@/api/deployment/api", () => ({
  deploymentStorageKey: (key: string) => key,
  resolveApiBase: async () => "https://sync.example.test",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (message: { payload: unknown }) => void) => {
    native.listeners.set(event, handler);
    return () => native.listeners.delete(event);
  }),
}));

/** With no native window in a test, this window's id is `local`. */
const ownKey = "workspace:w:local";
let close: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  native.values.clear();
  native.fail = false;
  native.orphans = [];
  native.records.clear();
  native.refuseRecords = false;
  native.listeners.clear();
  native.invoke.mockReset().mockImplementation(
    async (
      command: string,
      args: {
        sessionId: string;
        accountId: string;
        key: string;
        revision: number;
        value: string;
        collection: string;
        writes: { id: string; record: unknown }[];
      },
    ) => {
      if (command === "profile_window_take_orphans") return native.orphans.splice(0);
      if (command === "profile_records_list")
        return [...(native.records.get(args.collection)?.values() ?? [])];
      if (command === "profile_records_write") {
        if (native.refuseRecords) throw new Error("Records unavailable");
        const stored = native.records.get(args.collection) ?? new Map();
        for (const { id, record } of args.writes)
          if (record) stored.set(id, record);
          else stored.delete(id);
        native.records.set(args.collection, stored);
        return [];
      }
      if (command === "browser_recovery_open") return { session_id: args.accountId };
      const id = `${args.sessionId}:${args.key}`;
      if (command === "browser_recovery_read") return native.values.get(id) ?? null;
      if (command === "browser_recovery_write") {
        if (native.fail) throw new Error("Disk unavailable");
        const old = native.values.get(id);
        if (old?.value === args.value) return old;
        if ((old?.revision ?? 0) !== args.revision) throw new Error("Revision changed");
        const result = { revision: args.revision + 1, value: args.value };
        native.values.set(id, result);
        return result;
      }
      return null;
    },
  );
});
afterEach(() => {
  close?.();
  close = undefined;
});

async function context() {
  const recovery = await import("../recovery/nativeWorkspaceRecovery");
  const { useWorkspaceStore: workspace } = await import("../tabs/useWorkspaceStore");
  close = recovery.closeNativeWorkspaceRecovery;
  return { ...recovery, workspace };
}
function legacy(title: string) {
  return JSON.stringify({
    version: 14,
    state: {
      activeScopeKey: "global",
      websiteGroups: [
        {
          kind: "group",
          id: "saved",
          fields: { label: title, icon: "globe", order: 0, hidden: false },
        },
      ],
    },
  });
}

function closedWindow(url: string, id: string) {
  const pane = { type: "leaf", id: `pane:${id}`, activeViewId: id, views: [view(url, id)] };
  return JSON.stringify({
    version: 18,
    state: {
      layout: {
        root: pane,
        focusedPaneId: pane.id,
        tabs: [
          { id: `layout:${id}`, root: pane, focusedPaneId: pane.id, tabGroupId: "open-group" },
        ],
        activeTabId: `layout:${id}`,
      },
      tabGroups: [{ id: "open-group", name: "Open", color: "blue", collapsed: false }],
    },
  });
}
function view(url: string, id: string) {
  return {
    id,
    surfaceId: "browser",
    groupKey: "tool:browser",
    instanceKey: id,
    title: url,
    route: "/browser",
    sidebarVisible: false,
    state: { version: 1, url, faviconUrl: null },
    createdAt: 1,
    lastFocusedAt: 1,
  };
}
function settled() {
  return vi.waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith("profile_window_take_orphans"),
  );
}

it("gives each window of a profile its own record", async () => {
  const h = await context();
  await h.restoreNativeWorkspace("a");
  const tab = h.workspace.getState().openBrowserView({ url: "https://own.example" });
  await h.flushNativeWorkspace("a");
  expect(native.values.get(`a:${ownKey}`)?.value).toContain(tab.id);
  expect(native.values.has("a:workspace")).toBe(false);
  expect(JSON.parse(native.values.get(`a:${ownKey}`)!.value).version).toBe(18);
});

it("takes over the legacy record once, then clears it after saving and seeding", async () => {
  native.values.set("a:workspace", { revision: 3, value: legacy("Old bookmarks") });
  const h = await context();
  await h.restoreNativeWorkspace("a");
  await vi.waitFor(() => expect(native.records.get("bookmarks")?.size).toBe(1));
  await vi.waitFor(() => expect(native.values.get("a:workspace")?.value).toBe(""));
  expect(native.values.has(`a:${ownKey}`)).toBe(true);
  expect(h.workspace.getState().bookmarkFolders[0].fields.label).toBe("Old bookmarks");
});

it("keeps the legacy record until the profile's records accept what it holds", async () => {
  native.values.set("a:workspace", { revision: 3, value: legacy("Kept") });
  native.refuseRecords = true;
  const h = await context();
  await h.restoreNativeWorkspace("a");
  await h.flushNativeWorkspace("a");
  expect(native.values.get("a:workspace")?.value).toBe(legacy("Kept"));
  expect(JSON.parse(native.values.get(`a:${ownKey}`)!.value).state.bookmarkFolders).toBeUndefined();
});

it("reads legacy bookmarks again on a later start that couldn't seed them", async () => {
  native.values.set("a:workspace", { revision: 3, value: legacy("Later") });
  native.refuseRecords = true;
  const first = await context();
  await first.restoreNativeWorkspace("a");
  await first.flushNativeWorkspace("a");
  first.closeNativeWorkspaceRecovery();
  native.refuseRecords = false;
  const again = await context();
  await again.restoreNativeWorkspace("a");
  await vi.waitFor(() => expect(native.values.get("a:workspace")?.value).toBe(""));
  expect(native.records.get("bookmarks")?.size).toBe(1);
});

it("leaves the legacy record alone in another profile's window", async () => {
  native.values.set("a:workspace", { revision: 3, value: legacy("Not yours") });
  const h = await context();
  const { useProfileWindowStore } = await import("./profileWindow");
  useProfileWindowStore.setState({
    profile: { id: "work", name: "Work", order: 1, sites: [] },
  });
  await h.restoreNativeWorkspace("a");
  await h.flushNativeWorkspace("a");
  expect(native.values.get("a:workspace")?.value).toBe(legacy("Not yours"));
  expect(h.workspace.getState().bookmarkFolders.some((f) => f.fields.label === "Not yours")).toBe(
    false,
  );
});

it("doesn't read another window's record as its own", async () => {
  native.values.set("a:workspace:w:other", {
    revision: 1,
    value: closedWindow("https://x.test", "x"),
  });
  const h = await context();
  await h.restoreNativeWorkspace("a");
  expect(JSON.stringify(h.workspace.getState().layout)).not.toContain("https://x.test");
});

it("moves a closed window's tabs here asleep, saves, and only then clears its record", async () => {
  native.values.set("a:workspace:w:closed", {
    revision: 1,
    value: closedWindow("https://closed.example", "tab:closed"),
  });
  native.orphans = ["closed"];
  const h = await context();
  await h.restoreNativeWorkspace("a");
  await settled();
  await vi.waitFor(() => expect(native.values.get("a:workspace:w:closed")?.value).toBe(""));
  const state = h.workspace.getState();
  expect(JSON.stringify(state.layout)).toContain("tab:closed");
  expect(state.tabGroups.map((group) => group.id)).toEqual(["open-group"]);
  expect(native.values.get(`a:${ownKey}`)?.value).toContain("tab:closed");
});

it("takes orphans on the event too, and keeps the tab on screen", async () => {
  const h = await context();
  await h.restoreNativeWorkspace("a");
  await settled();
  const mine = h.workspace.getState().openBrowserView({ url: "https://mine.example" });
  const active = h.workspace.getState().layout.activeTabId;
  native.values.set("a:workspace:w:later", {
    revision: 1,
    value: closedWindow("https://later.example", "tab:later"),
  });
  native.orphans = ["later"];
  native.listeners.get("misty://profile-window-orphans")?.({ payload: null });
  await vi.waitFor(() => expect(native.values.get("a:workspace:w:later")?.value).toBe(""));
  const state = h.workspace.getState();
  expect(state.layout.activeTabId).toBe(active);
  const saved = JSON.stringify(state.layout);
  expect(saved).toContain(mine.id);
  expect(saved).toContain("tab:later");
});

it("keeps a closed window's record when saving its tabs here fails", async () => {
  native.values.set("a:workspace:w:closed", {
    revision: 1,
    value: closedWindow("https://closed.example", "tab:closed"),
  });
  const h = await context();
  await h.restoreNativeWorkspace("a");
  await settled();
  native.fail = true;
  native.orphans = ["closed"];
  native.listeners.get("misty://profile-window-orphans")?.({ payload: null });
  await vi.waitFor(() =>
    expect(JSON.stringify(h.workspace.getState().layout)).toContain("tab:closed"),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(native.values.get("a:workspace:w:closed")?.value).toContain("tab:closed");
});
