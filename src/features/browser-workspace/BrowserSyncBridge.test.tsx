import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWorkspaceVirtualWindow } from "@/features/workspace/virtualWindows";
const mocks = vi.hoisted(() => ({
  baseline: {} as unknown,
  live: {} as unknown,
  session: {} as unknown,
  acknowledge: vi.fn(),
  controller: vi.fn(),
  changed: undefined as (() => void) | undefined,
  flush: vi.fn(),
  values: new Map<string, string>(),
}));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "https://sync.example" }));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: () => false,
  readApiSessionGeneration: () => 1,
}));
vi.mock("@/features/auth", () => ({ accountScopeWillResetEvent: "reset-account" }));
vi.mock("@/features/app-shell", () => ({
  useAppStore: { getState: () => ({ setError: vi.fn() }) },
}));
vi.mock("@/features/workspace/nativeWorkspaceRecovery", () => ({
  pendingRecoveredWorkspace: () => mocks.baseline,
  acknowledgeRecoveredWorkspace: mocks.acknowledge,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/webviews/browserRuntime", () => ({ browserProfileChanged: vi.fn() }));
vi.mock("./source", () => ({
  workspaceSource: { read: () => mocks.live, subscribe: () => () => {}, write: vi.fn() },
}));
vi.mock("./controller", () => ({
  canProjectWorkspace: () => true,
  WorkspaceSyncController: class {
    constructor(...args: unknown[]) {
      mocks.controller(...args);
    }
    stop() {}
    refresh() {}
    async flushLocal() {}
  },
}));
vi.mock("./native", () => ({
  readNativeSync: async () => mocks.session,
  watchNativeSync: async (changed: () => void) => {
    mocks.changed = changed;
    return () => {};
  },
  watchNativeProfile: async () => () => {},
  activeDeviceEpoch: (session: { active: boolean }) => (session.active ? "epoch" : null),
  editNativeWorkspace: vi.fn(),
  saveNativeResume: vi.fn(),
}));
vi.mock("./recovery", () => ({
  openWorkspaceRecovery: async () => ({
    storage: {
      getItem: (key: string) => mocks.values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mocks.values.set(key, value);
      },
      flush: mocks.flush,
    },
    release: vi.fn(),
  }),
  migrateRecoveryRecord: async () => {},
  recoveryKey: async () => "edits",
  registerRecoveryFlush: () => () => {},
}));
import { BrowserSyncBridge } from "./BrowserSyncBridge";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.values.clear();
  mocks.values.set("before-sync", "{}");
  mocks.flush.mockResolvedValue(undefined);
  mocks.baseline = { virtualWindowsByScope: { global: [] }, websiteGroups: [], savedWebsites: [] };
  mocks.live = { windows: [createWorkspaceVirtualWindow()], groups: [], websites: [] };
  mocks.session = {
    account_id: "a",
    deployment: "https://sync.example",
    workspace_id: "w",
    device_id: "d",
    profile_id: "p",
    active: true,
    workspace: { records: [{ kind: "window", id: "remote" }] },
    pending_operation_ids: [],
  };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("queues recovered tabs before a controller may project cloud data and saves before acknowledging", async () => {
  await act(async () => root.render(<BrowserSyncBridge accountId="a" />));
  expect(mocks.controller).toHaveBeenCalledTimes(1);
  const journal = mocks.controller.mock.calls[0][1].journal;
  expect(journal.pending.flatMap((edit: { changes: unknown[] }) => edit.changes)).toEqual(
    expect.arrayContaining([expect.objectContaining({ action: "create", kind: "tab" })]),
  );
  expect(journal.pending[0].activeEpoch).toBe("epoch");
  expect(mocks.acknowledge).toHaveBeenCalledWith("a");
  expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.acknowledge.mock.invocationCallOrder[0],
  );
});
it("preserves the recovery baseline when the journal cannot be saved", async () => {
  mocks.flush.mockRejectedValue(new Error("Disk unavailable"));
  await act(async () => root.render(<BrowserSyncBridge accountId="a" />));
  expect(mocks.acknowledge).not.toHaveBeenCalled();
});
it("leaves a brand-new vault empty so the controller seeds all local windows", async () => {
  mocks.session = { ...(mocks.session as object), workspace: { records: [] } };
  await act(async () => root.render(<BrowserSyncBridge accountId="a" />));
  expect(mocks.controller.mock.calls[0][1].journal.pending).toHaveLength(0);
  expect(mocks.acknowledge).toHaveBeenCalledWith("a");
});
it("waits for this device to become active before publishing recovered work", async () => {
  mocks.session = { ...(mocks.session as object), active: false };
  await act(async () => root.render(<BrowserSyncBridge accountId="a" />));
  expect(mocks.controller).not.toHaveBeenCalled();
  expect(mocks.acknowledge).not.toHaveBeenCalled();
  mocks.session = { ...(mocks.session as object), active: true };
  await act(async () => mocks.changed?.());
  expect(mocks.controller).toHaveBeenCalledTimes(1);
});
