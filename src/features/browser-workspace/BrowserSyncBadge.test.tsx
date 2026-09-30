import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { create } from "zustand";
const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  unlock: vi.fn(),
  lock: vi.fn(),
  forget: vi.fn(),
  read: vi.fn(),
  control: vi.fn(),
  claim: vi.fn(),
  rename: vi.fn(),
  refresh: vi.fn(),
  recovery: vi.fn(),
  credentials: vi.fn(),
  generation: 1,
  user: { id: "a", name: "User" } as { id: string; name: string } | null,
}));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: () => false,
  readApiSessionGeneration: () => mocks.generation,
  readApiAuthToken: mocks.credentials,
}));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "https://example.test" }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: mocks.user, transitioning: false }) }));
vi.mock("@/features/auth/core", () => ({
  useUserStore: (select: (s: unknown) => unknown) => select({ me: { name: "User" } }),
}));
vi.mock("@/features/settings/profiles/store", () => ({
  useSettingsProfiles: create(() => ({
    accountId: "a",
    ready: true,
    syncing: false,
    error: null,
    state: { outbox: [], profile: {} },
    refresh: mocks.refresh,
  })),
}));
vi.mock("@/features/workspace/nativeWorkspaceRecovery", () => ({
  useWorkspaceRecoveryState: create(() => ({
    accountId: "a",
    ready: true,
    usable: true,
    issue: null,
  })),
}));
vi.mock("@/features/workspace/useWorkspaceRecoveryRetry", () => ({
  retryWorkspaceRecovery: mocks.recovery,
}));
vi.mock("@/features/workspace/workspaceRecoveryPlatform", () => ({
  nativeWorkspaceRecoveryEnabled: () => true,
}));
vi.mock("./native", () => ({
  readNativeSync: mocks.read,
  unlockNativeSync: mocks.unlock,
  lockNativeSync: mocks.lock,
  forgetNativeSyncKey: mocks.forget,
  vaultAvailability: mocks.availability,
  controlNativeDevice: mocks.control,
  claimNativeWorkspace: mocks.claim,
  renameNativeDevice: mocks.rename,
  generateSyncSecret: async () => "A".repeat(43) + "=",
}));
vi.mock("./restore/capture", () => ({ captureAll: async () => {} }));
import { useBrowserSyncStore } from "./store";
import { syncSession } from "./syncTestFixtures";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 1;
  mocks.user = { id: "a", name: "User" };
  mocks.availability.mockResolvedValue({ local: true, remote: true });
  mocks.unlock.mockResolvedValue(syncSession());
  mocks.read.mockResolvedValue(null);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.credentials.mockResolvedValue("token");
  useWorkspaceRecoveryState.setState({ accountId: "a", ready: true, issue: null });
  useBrowserSyncStore.setState({
    session: syncSession(),
    issue: null,
    reenroll: null,
    connecting: false,
    locked: null,
  });
});
afterEach(cleanup);
import { BrowserSyncBadge } from "./BrowserSyncBadge";
import { retrySync } from "./retrySync";
async function open(settings = vi.fn()) {
  render(<BrowserSyncBadge accountId="a" onOpenSettings={settings} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Sync:/ })));
  return settings;
}
it("leads with status and detail, shows visible tabs actions and no mode switches", async () => {
  const settings = await open();
  const popup = screen.getByRole("dialog", { name: "Sync" });
  expect(within(popup).getByText(/Your workspace and account settings are synced/)).toBeTruthy();
  expect(within(popup).getByRole("button", { name: "Open tabs from Office here" })).toBeTruthy();
  expect(within(popup).queryByRole("switch")).toBeNull();
  expect(popup.textContent).not.toMatch(/take over|seat|Switch to/);
  fireEvent.click(within(popup).getByRole("button", { name: "Manage sync" }));
  expect(settings).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("unlocks with the saved key in place", async () => {
  useBrowserSyncStore.setState({ session: null, locked: "a" });
  const settings = await open();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Unlock sync" })));
  expect(mocks.unlock).toHaveBeenCalledWith(
    { apiBase: "https://example.test", accountId: "a" },
    null,
    null,
    false,
  );
  expect(settings).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Up to date")).toBeTruthy();
});
it("offers one reconnect action and replaces it with the re-enrollment form", async () => {
  useBrowserSyncStore.setState({ issue: "sync_device_forbidden" });
  await open();
  expect(screen.getAllByRole("button", { name: "Reconnect device" })).toHaveLength(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reconnect device" })));
  expect(mocks.lock).toHaveBeenCalledWith("s", true);
  expect(mocks.unlock).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Sync password")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Use saved device key" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Reconnect device" })).toHaveLength(1);
});
it("falls back to credentials when no saved key is available", async () => {
  useBrowserSyncStore.setState({ session: null });
  mocks.availability.mockResolvedValue({ local: false, remote: true });
  mocks.unlock.mockRejectedValue(new Error("no key"));
  await open();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Unlock sync" })));
  expect(screen.getByLabelText("Sync secret")).toBeTruthy();
});
it("waits for acknowledged opening and keeps account transitions safe", async () => {
  await open();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Open tabs from Office here" })),
  );
  expect(mocks.claim).toHaveBeenCalledWith("s", "other");
  expect(screen.getByText("Waiting for the device to confirm…")).toBeTruthy();
  // Opening moves this machine onto the workspace; the online owner keeps its lease.
  act(() =>
    useBrowserSyncStore.setState({
      session: syncSession({ sync: { ...syncSession().sync!, on_workspace: "other" } }),
    }),
  );
  expect(screen.getByText("Open here")).toBeTruthy();
});
it("does not reconnect after an account change during recovery", async () => {
  useWorkspaceRecoveryState.setState({ issue: "disk" });
  let finish!: () => void;
  mocks.recovery.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Retry sync" }));
  mocks.generation++;
  await act(async () => finish());
  expect(mocks.unlock).not.toHaveBeenCalled();
});

it("shares one in-flight native recovery across surfaces", async () => {
  let finish!: (value: ReturnType<typeof syncSession>) => void;
  mocks.unlock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = retrySync("a");
  const second = retrySync("a");
  expect(first).toBe(second);
  await waitFor(() => expect(mocks.unlock).toHaveBeenCalledOnce());
  finish(syncSession());
  expect(await first).toBe("complete");
});
it("does not let a settings-only retry swallow workspace recovery", async () => {
  let finish!: () => void;
  const refreshing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  mocks.refresh.mockReturnValue(refreshing);
  const settings = retrySync("a", "retry", true);
  const workspace = retrySync("a");
  expect(settings).not.toBe(workspace);
  finish();
  expect(await settings).toBe("complete");
  expect(await workspace).toBe("complete");
  expect(mocks.unlock).toHaveBeenCalledOnce();
});
it("discards native results after an account transition", async () => {
  let finish!: (value: ReturnType<typeof syncSession>) => void;
  mocks.unlock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const attempt = retrySync("a");
  await waitFor(() => expect(mocks.unlock).toHaveBeenCalledOnce());
  mocks.generation++;
  useBrowserSyncStore.setState({ session: null });
  finish(syncSession());
  expect(await attempt).toBe("stale");
  expect(useBrowserSyncStore.getState().session).toBeNull();
});

it("still reconnects the workspace when settings refresh fails", async () => {
  mocks.refresh.mockRejectedValue(new Error("settings unavailable"));
  expect(await retrySync("a")).toBe("complete");
  expect(mocks.unlock).toHaveBeenCalledOnce();
});
