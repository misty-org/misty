import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  watchNativeSync: async () => () => {},
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
import { BrowserSyncSettings } from "./BrowserSyncSettings";
import type { SettingsContentProps } from "@/features/settings/settingsTypes";
const props = {
  document: {},
  working: false,
  onSettingChange: vi.fn(),
  onLoad: vi.fn(),
  shortcuts: null,
  launchOnLogin: null,
  openWithAssociations: [],
  app: null,
  onShortcutChange: vi.fn(),
  onShortcutReassign: vi.fn(),
  onResetShortcuts: vi.fn(),
  onRemoveOpenWithAssociation: vi.fn(),
} as SettingsContentProps;
async function mount() {
  await act(async () => {
    render(<BrowserSyncSettings {...props} />);
  });
}
it("groups every sync concern on one page and explains the publisher", async () => {
  await mount();
  for (const name of [
    "Overview",
    "Workspace devices",
    "Website sign-ins",
    "Switching devices",
    "Settings sync",
    "Sync account",
  ])
    expect(screen.getByRole("region", { name })).toBeTruthy();
  expect(
    screen.getByText("Publishing from").closest("[data-setting-label]")?.textContent,
  ).toContain("MacBook");
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText(/saved to your account on the server/)).toBeTruthy();
});
it("writes restore preferences through the settings callback and disables dependent restore", async () => {
  await mount();
  fireEvent.click(
    screen.getByRole("switch", { name: "Restore page state when switching devices" }),
  );
  expect(props.onSettingChange).toHaveBeenCalledWith("privacy", "page_state_restore", false);
  cleanup();
  render(<BrowserSyncSettings {...props} document={{ privacy: { page_state_restore: false } }} />);
  expect(
    screen.getByRole("switch", { name: "Let agents finish restoring" }).hasAttribute("disabled"),
  ).toBe(true);
});
it("writes labeled mode changes and waits for server confirmation", async () => {
  await mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("switch", { name: "Full sync for Office" })),
  );
  expect(mocks.control).toHaveBeenCalledWith("s", "other", false, false);
  expect(screen.getByText("Waiting for the device to confirm…")).toBeTruthy();
  const view = syncSession();
  view.devices![1].full_sync = false;
  act(() => useBrowserSyncStore.setState({ session: view }));
  expect(screen.getByText(/Independent workspace/)).toBeTruthy();
});
it("confirms opening another device's tabs without taking its sign-in lease", async () => {
  const twoWorkspaces = () => {
    const view = syncSession();
    view.sync!.workspaces.push({
      workspace_id: "other",
      shared: false,
      driver_device_id: "other",
      driver_epoch: "o",
      driver_seen_at: 1,
      version: 1,
    });
    return view;
  };
  useBrowserSyncStore.setState({ session: twoWorkspaces() });
  await mount();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Open tabs from .* here/ })),
  );
  expect(mocks.claim).toHaveBeenCalledWith("s", "other");
  expect(screen.getByText("Waiting for the device to confirm…")).toBeTruthy();
  // The online holder keeps the lease; this machine only moves onto its workspace.
  const opened = twoWorkspaces();
  opened.sync!.on_workspace = "other";
  act(() => useBrowserSyncStore.setState({ session: opened }));
  expect(screen.queryByText("Waiting for the device to confirm…")).toBeNull();
  expect(screen.getByText("Open here")).toBeTruthy();
});
it("absorbs device names into inline rename", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Rename Office" }));
  const input = screen.getByRole("textbox", { name: "Name for Office" });
  fireEvent.change(input, { target: { value: "Studio" } });
  await act(async () => fireEvent.blur(input));
  expect(mocks.rename).toHaveBeenCalledWith("s", "other", "Studio");
});
it("preserves an unlock path even if loading account credentials fails", async () => {
  useBrowserSyncStore.setState({ session: null });
  mocks.credentials.mockRejectedValue(new Error("offline"));
  await mount();
  expect(screen.getByLabelText("Sync password")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create sync vault" })).toBeNull();
});
it("only offers creation after the server confirms vault absence", async () => {
  useBrowserSyncStore.setState({ session: null });
  mocks.availability.mockResolvedValue({ local: false, remote: false });
  await mount();
  expect(screen.getByRole("button", { name: "Create sync vault" })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Set up sync" })));
  expect(document.activeElement).toBe(screen.getByLabelText("Sync password"));
});
it("locks sync and prevents background auto-unlock; forgetting removes the saved key", async () => {
  await mount();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Forget key" })));
  expect(mocks.lock).toHaveBeenCalledWith("s", true);
  expect(useBrowserSyncStore.getState().locked).toBe("a");
  expect(screen.getByLabelText("Sync password")).toBeTruthy();
});
it("clears old-account forms when the account changes", async () => {
  useBrowserSyncStore.setState({ session: null });
  const view = render(<BrowserSyncSettings {...props} />);
  await waitFor(() => expect(screen.getByLabelText("Sync password")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Sync password"), {
    target: { value: "old account password" },
  });
  mocks.user = { id: "b", name: "Other" };
  mocks.generation++;
  await act(async () => view.rerender(<BrowserSyncSettings {...props} />));
  expect((screen.getByLabelText("Sync password") as HTMLInputElement).value).toBe("");
});
