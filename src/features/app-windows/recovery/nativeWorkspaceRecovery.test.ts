import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openPage } from "@/tests/workspacePage";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  generation: 1,
  fail: false,
  failRead: false,
  paused: undefined as undefined | (() => Promise<unknown>),
  values: new Map<
    string,
    {
      revision: number;
      value: string;
    }
  >(),
  account: "",
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
}));
vi.mock("@/shared/platform/tauri", () => ({
  hasTauriInternals: () => true,
}));
vi.mock("@/app/shell/useAppStore", () => ({
  useAppStore: {
    getState: () => ({
      setError: vi.fn(),
    }),
  },
}));
vi.mock("@/api/client/session", () => ({
  readApiSessionGeneration: () => native.generation,
}));
vi.mock("@/api/deployment/api", () => ({
  deploymentStorageKey: (key: string) => key,
  resolveApiBase: async () => "https://sync.example.test",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
}));
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
  native.generation = 1;
  native.fail = false;
  native.failRead = false;
  native.account = "";
  native.paused = undefined;
  native.listeners.clear();
  native.invoke.mockReset().mockImplementation(
    async (
      command: string,
      args: {
        accountId: string;
        sessionId: string;
        key: string;
        revision: number;
        value: string;
      },
    ) => {
      if (command === "profile_window_take_orphans") return [];
      if (command === "profile_window_info") return null;
      if (command === "browser_recovery_open") {
        if (native.failRead) throw new Error("Keychain unavailable");
        native.account = args.accountId;
        return {
          session_id: args.accountId,
        };
      }
      const id = `${args.sessionId}:${args.key}`;
      if (command === "browser_recovery_read") {
        if (native.paused) {
          const pause = native.paused;
          native.paused = undefined;
          return pause();
        }
        return native.values.get(id) ?? null;
      }
      if (command === "browser_recovery_write") {
        if (native.fail) throw new Error("Disk unavailable; existing recovery preserved");
        if (native.account !== args.sessionId) throw new Error("Account changed");
        const old = native.values.get(id);
        if (old?.value === args.value) return old;
        if ((old?.revision ?? 0) !== args.revision) throw new Error("Revision changed");
        const result = {
          revision: args.revision + 1,
          value: args.value,
        };
        native.values.set(id, result);
        return result;
      }
      throw new Error(`Unexpected ${command}`);
    },
  );
});
afterEach(() => {
  close?.();
  close = undefined;
  vi.useRealTimers();
});
async function context() {
  const recovery = await import("./nativeWorkspaceRecovery");
  const { useWorkspaceStore: workspace } = await import("../tabs/useWorkspaceStore");
  close = recovery.closeNativeWorkspaceRecovery;
  return {
    ...recovery,
    workspace,
  };
}
it("stays usable on failed native writes and can retry without resetting data", async () => {
  const h = await context();
  native.fail = true;
  await h.restoreNativeWorkspace("a");
  expect(h.useWorkspaceRecoveryState.getState().ready).toBe(false);
  expect(h.useWorkspaceRecoveryState.getState().usable).toBe(true);
  const tab = openPage(h.workspace.getState(), { url: "https://new.example" });
  native.fail = false;
  await h.restoreNativeWorkspace("a");
  expect(JSON.stringify(h.workspace.getState().layout)).toContain(tab.id);
});
it("keeps temporary tabs selected while restoring old windows after an unreadable store recovers", async () => {
  const h = await context();
  await h.restoreNativeWorkspace("a");
  const saved = openPage(h.workspace.getState(), { url: "https://saved.example" });
  await h.flushNativeWorkspace("a");
  h.closeNativeWorkspaceRecovery();
  native.failRead = true;
  await h.restoreNativeWorkspace("a");
  expect(h.useWorkspaceRecoveryState.getState()).toMatchObject({
    usable: true,
    ready: false,
  });
  const added = openPage(h.workspace.getState(), { url: "https://temporary.example" });
  const active = h.workspace.getState().activeWindowId;
  await expect(h.flushNativeWorkspace("a")).rejects.toThrow("unsaved changes");
  await h.restoreNativeWorkspace("a");
  expect(h.workspace.getState().activeWindowId).toBe(active);
  native.failRead = false;
  await h.restoreNativeWorkspace("a");
  expect(h.useWorkspaceRecoveryState.getState()).toMatchObject({
    ready: true,
    issue: null,
  });
  const windows = JSON.stringify(h.workspace.getState().layout);
  expect(windows).toContain(saved.id);
  expect(windows).toContain(added.id);
  expect(h.workspace.getState().activeWindowId).toBe(active);
});
it("does not expose a previous account when recovery fails for the next account", async () => {
  const h = await context();
  await h.restoreNativeWorkspace("a");
  openPage(h.workspace.getState(), { url: "https://private.example" });
  await h.flushNativeWorkspace("a");
  h.closeNativeWorkspaceRecovery();
  native.generation++;
  native.failRead = true;
  await h.restoreNativeWorkspace("b");
  expect(JSON.stringify(h.workspace.getState().layout)).not.toContain("private.example");
  expect(h.useWorkspaceRecoveryState.getState()).toMatchObject({
    accountId: "b",
    usable: true,
  });
});
it("discards a late hydration from the previous account without clearing the new one", async () => {
  const h = await context();
  let release!: (value: unknown) => void;
  native.paused = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const old = h.restoreNativeWorkspace("a");
  await vi.waitFor(() => expect(release).toBeDefined());
  h.closeNativeWorkspaceRecovery();
  native.generation++;
  await h.restoreNativeWorkspace("b");
  const newLayout = h.workspace.getState().layout;
  release({
    revision: 1,
    value: JSON.stringify({ version: 19, state: {} }),
  });
  await old;
  expect(h.useWorkspaceRecoveryState.getState()).toMatchObject({
    accountId: "b",
    ready: true,
  });
  expect(h.workspace.getState().layout).toBe(newLayout);
});
it("coalesces resize bursts and persists a continuous burst within two seconds", async () => {
  const h = await context();
  await h.restoreNativeWorkspace("a");
  vi.useFakeTimers();
  native.invoke.mockClear();
  for (let i = 0; i < 50; i++)
    h.workspace.setState({ lastUsedViewByGroup: { "tool:agents": `view-${i}` } });
  await vi.advanceTimersByTimeAsync(400);
  expect(
    native.invoke.mock.calls.filter(([command]) => command === "browser_recovery_write"),
  ).toHaveLength(1);
  native.invoke.mockClear();
  for (let i = 0; i < 10; i++) {
    h.workspace.setState({ lastUsedViewByGroup: { "tool:agents": `later-${i}` } });
    await vi.advanceTimersByTimeAsync(200);
  }
  expect(
    native.invoke.mock.calls.filter(([command]) => command === "browser_recovery_write"),
  ).toHaveLength(1);
  await h.flushNativeWorkspace("a");
  expect(
    native.invoke.mock.calls.filter(([command]) => command === "browser_recovery_write"),
  ).toHaveLength(1);
});

it("starts fresh from an unreadable save, keeping the original", async () => {
  native.values.set(`a:${ownKey}`, { revision: 1, value: "{not a workspace" });
  const h = await context();
  await h.restoreNativeWorkspace("a");
  expect(h.useWorkspaceRecoveryState.getState()).toMatchObject({
    usable: true,
    ready: true,
    issue: null,
  });
  const archived = [...native.values].filter(([id]) => id.startsWith("a:archive:"));
  expect(archived.map(([, record]) => record.value)).toContain("{not a workspace");
  // The fresh workspace saves normally over the unreadable copy.
  const tab = openPage(h.workspace.getState(), { url: "https://after.example" });
  await h.flushNativeWorkspace("a");
  expect(native.values.get(`a:${ownKey}`)?.value).toContain(tab.id);
});

it("leaves out a saved view this build can't show and keeps the other tabs", async () => {
  const h = await context();
  await h.restoreNativeWorkspace("a");
  const damaged = openPage(h.workspace.getState(), { url: "https://damaged.example" });
  const kept = openPage(h.workspace.getState(), { url: "https://kept.example" });
  await h.flushNativeWorkspace("a");
  h.closeNativeWorkspaceRecovery();
  const record = native.values.get(`a:${ownKey}`)!;
  const saved = JSON.parse(record.value);
  // A route no page of this build has.
  let hits = 0;
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const view = node as { id?: string; route?: unknown };
    if (view.id === damaged.id && "route" in view) {
      view.route = "http://[";
      hits++;
    }
    Object.values(node).forEach(walk);
  };
  walk(saved);
  expect(hits).toBeGreaterThan(0);
  native.values.set(`a:${ownKey}`, { ...record, value: JSON.stringify(saved) });
  const again = await context();
  await again.restoreNativeWorkspace("a");
  const state = again.useWorkspaceRecoveryState.getState();
  expect(state).toMatchObject({ usable: true, ready: true, issue: null });
  const layout = JSON.stringify(again.workspace.getState().layout);
  expect(layout).not.toContain(damaged.id);
  expect(layout).toContain(kept.id);
});

it("lists refused saves per item instead of reporting a blanket failure", async () => {
  const h = await context();
  native.fail = true;
  await h.restoreNativeWorkspace("a");
  const state = h.useWorkspaceRecoveryState.getState();
  expect(state.issue).toBeNull();
  expect(state.usable).toBe(true);
  expect(state.saves.failed.map((f) => f.key)).toContain(ownKey);
});
