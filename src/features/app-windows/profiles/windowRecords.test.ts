import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openPage } from "@/tests/workspacePage";

/** Each window's own record and closed windows' tabs. */
const native = vi.hoisted(() => ({
  values: new Map<string, { revision: number; value: string }>(),
  fail: false,
  orphans: [] as string[],
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
      },
    ) => {
      if (command === "profile_window_take_orphans") return native.orphans.splice(0);
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
function closedWindow(url: string, id: string) {
  const pane = { type: "leaf", id: `pane:${id}`, activeViewId: id, views: [view(url, id)] };
  return JSON.stringify({
    version: 19,
    state: {
      layout: {
        root: pane,
        focusedPaneId: pane.id,
        tabs: [{ id: `layout:${id}`, root: pane, focusedPaneId: pane.id }],
        activeTabId: `layout:${id}`,
      },
    },
  });
}
function view(url: string, id: string) {
  return {
    id,
    surfaceId: "agents",
    groupKey: "tool:agents",
    instanceKey: id,
    title: url,
    route: `/agents?conversation=${encodeURIComponent(url)}`,
    sidebarVisible: false,
    state: {},
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
  const tab = openPage(h.workspace.getState(), { url: "https://own.example" });
  await h.flushNativeWorkspace("a");
  expect(native.values.get(`a:${ownKey}`)?.value).toContain(tab.id);
  expect(native.values.has("a:workspace")).toBe(false);
  expect(JSON.parse(native.values.get(`a:${ownKey}`)!.value).version).toBe(19);
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
  expect(native.values.get(`a:${ownKey}`)?.value).toContain("tab:closed");
});

it("takes orphans on the event too, and keeps the tab on screen", async () => {
  const h = await context();
  await h.restoreNativeWorkspace("a");
  await settled();
  const mine = openPage(h.workspace.getState(), { url: "https://mine.example" });
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
