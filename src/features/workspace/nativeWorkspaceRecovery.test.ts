import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  generation: 1,
  fail: false,
  paused: undefined as undefined | (() => Promise<unknown>),
  values: new Map<string, { revision: number; value: string }>(),
  account: "",
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/shared/platform/buildTarget", () => ({ isNativeMobileBuild: false }));
vi.mock("@/features/app-shell/store/useAppStore", () => ({
  useAppStore: { getState: () => ({ setError: vi.fn() }) },
}));
vi.mock("@/api/client/session", () => ({ readApiSessionGeneration: () => native.generation }));
vi.mock("@/api/deployment/api", () => ({
  deploymentStorageKey: (key: string) => key,
  resolveApiBase: async () => "https://sync.example.test",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
let close: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  native.values.clear();
  native.generation = 1;
  native.fail = false;
  native.account = "";
  native.paused = undefined;
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
      if (command === "browser_recovery_open") {
        native.account = args.accountId;
        return { session_id: args.accountId };
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
        const result = { revision: args.revision + 1, value: args.value };
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
  const { useWorkspaceStore: workspace } = await import("./useWorkspaceStore");
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
it("migrates the owned latest global layout, archives account/legacy copies, then writes only native storage", async () => {
  const globalKey = "misty:desktop-dock:space-apps-v1";
  const raw = legacy("Latest");
  localStorage.setItem(globalKey, raw);
  localStorage.setItem("misty_user", JSON.stringify({ id: "a" }));
  localStorage.setItem("misty:active-account-id", "a");
  localStorage.setItem("misty:workspace-account:a", legacy("Old"));
  const h = await context();
  const browserWrite = vi.spyOn(localStorage, "setItem");
  await h.restoreNativeWorkspace("a");
  expect(h.workspace.getState().websiteGroups[0].fields.label).toBe("Latest");
  expect(h.useWorkspaceRecoveryState.getState()).toMatchObject({ accountId: "a", ready: true });
  expect(localStorage.getItem(globalKey)).toBeNull();
  expect(localStorage.getItem("misty:workspace-account:a")).toBeNull();
  expect(
    [...native.values.entries()]
      .filter(([key]) => key.startsWith("a:archive:"))
      .map(([, record]) => record.value),
  ).toContain(raw);
  h.workspace.getState().reset();
  await h.flushNativeWorkspace("a");
  expect(browserWrite).not.toHaveBeenCalled();
});
it("preserves browser originals on failed native writes and can retry without resetting data", async () => {
  const raw = legacy("Recover me");
  localStorage.setItem("misty:workspace-account:a", raw);
  const h = await context();
  native.fail = true;
  await expect(h.restoreNativeWorkspace("a")).rejects.toThrow("Disk unavailable");
  expect(localStorage.getItem("misty:workspace-account:a")).toBe(raw);
  expect(h.useWorkspaceRecoveryState.getState().ready).toBe(false);
  native.fail = false;
  await h.restoreNativeWorkspace("a");
  expect(h.workspace.getState().websiteGroups[0].fields.label).toBe("Recover me");
  expect(localStorage.getItem("misty:workspace-account:a")).toBeNull();
});
it("does not import an unowned global layout into a newly signed-in account", async () => {
  const raw = legacy("Private old layout");
  localStorage.setItem("misty:desktop-dock:space-apps-v1", raw);
  localStorage.setItem("misty_user", JSON.stringify({ id: "a" }));
  localStorage.setItem("misty:active-account-id", "a");
  const h = await context();
  localStorage.setItem("misty_user", JSON.stringify({ id: "b" }));
  localStorage.setItem("misty:active-account-id", "b");
  await h.restoreNativeWorkspace("b");
  expect(
    h.workspace
      .getState()
      .websiteGroups.some((group) => group.fields.label === "Private old layout"),
  ).toBe(false);
  expect(localStorage.getItem("misty:desktop-dock:space-apps-v1")).toBe(raw);
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
  release({ revision: 1, value: legacy("Old account") });
  await old;
  expect(h.useWorkspaceRecoveryState.getState()).toMatchObject({ accountId: "b", ready: true });
  expect(h.workspace.getState().layout).toBe(newLayout);
});
it("coalesces resize bursts and persists a continuous burst within two seconds", async () => {
  const h = await context();
  await h.restoreNativeWorkspace("a");
  vi.useFakeTimers();
  native.invoke.mockClear();
  for (let i = 0; i < 50; i++)
    h.workspace.setState({ selectedWebsiteByGroup: { saved: `site-${i}` } });
  await vi.advanceTimersByTimeAsync(400);
  expect(
    native.invoke.mock.calls.filter(([command]) => command === "browser_recovery_write"),
  ).toHaveLength(1);
  native.invoke.mockClear();
  for (let i = 0; i < 10; i++) {
    h.workspace.setState({ selectedWebsiteByGroup: { saved: `later-${i}` } });
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
