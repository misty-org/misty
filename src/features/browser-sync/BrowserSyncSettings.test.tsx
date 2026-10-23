import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { create } from "zustand";
import type * as AccountApi from "@/api/account/api";
const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  unlock: vi.fn(),
  lock: vi.fn(),
  forget: vi.fn(),
  deleteVault: vi.fn(),
  read: vi.fn(),
  control: vi.fn(),
  claim: vi.fn(),
  rename: vi.fn(),
  refresh: vi.fn(),
  recovery: vi.fn(),
  credentials: vi.fn(),
  reseal: vi.fn(),
  changeAccountPassword: vi.fn(),
  markCredential: vi.fn(),
  unmark: vi.fn(),
  me: vi.fn(),
  generation: 1,
  user: { id: "a", name: "User" } as { id: string; name: string; email?: string } | null,
}));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: () => false,
  readApiSessionGeneration: () => mocks.generation,
  readApiAuthToken: mocks.credentials,
}));
vi.mock("@/api/deployment/api", () => ({ resolveApiBase: async () => "https://example.test" }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/account/api", async (importOriginal) => ({
  ...(await importOriginal<typeof AccountApi>()),
  accountApi: { me: mocks.me },
}));
vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: mocks.user, transitioning: false }),
  accountChangePassword: mocks.changeAccountPassword,
  credentialEmail: () => null,
  deriveLoginCredential: async (_email: string, password: string) => `credential:${password}`,
  unmarkCredentialAccount: mocks.unmark,
  isCredentialAccount: () => true,
  markCredentialAccount: mocks.markCredential,
  passwordProblem: async () => null,
}));
vi.mock("@/features/auth/core", () => ({
  useUserStore: (select: (s: unknown) => unknown) => select({ me: { name: "User" } }),
}));
vi.mock("@/features/settings/devicePreferences/store", () => ({
  useDevicePreferences: create(() => ({
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
  resealSyncWithAccountPassword: mocks.reseal,
  lockNativeSync: mocks.lock,
  forgetNativeSyncKey: mocks.forget,
  deleteNativeSyncVault: mocks.deleteVault,
  vaultAvailability: mocks.availability,
  controlNativeDevice: mocks.control,
  claimNativeWorkspace: mocks.claim,
  renameNativeDevice: mocks.rename,
  generateSyncSecret: async () => "A".repeat(43) + "=",
}));
vi.mock("./restore/capture", () => ({ captureAll: async () => {} }));
import { SyncRestoreSettings } from "@/features/settings/sections/SyncRestoreSettings";
import { useBrowserSyncStore } from "./store";
import { syncSession } from "./syncStatus.testFixtures";
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
  mocks.me.mockResolvedValue({ provider: "misty" });
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
/** Moves the wizard from connecting to managing a connected workspace. */
async function manage() {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue" })));
}
it("opens the sync wizard and groups each concern on the manage step", async () => {
  await mount();
  expect(screen.getByRole("dialog", { name: "Sync" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Vault access" })).toBeTruthy();
  await manage();
  for (const name of ["Timing", "Workspace devices", "Website sign-ins"])
    expect(screen.getByRole("region", { name })).toBeTruthy();
  expect(
    screen.getByText("Publishing from").closest("[data-setting-label]")?.textContent,
  ).toContain("MacBook");
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
});
it("writes restore preferences through the settings callback and disables dependent restore", async () => {
  render(<SyncRestoreSettings {...props} />);
  fireEvent.click(
    screen.getByRole("switch", { name: "Restore page state when switching devices" }),
  );
  expect(props.onSettingChange).toHaveBeenCalledWith("privacy", "page_state_restore", false);
  cleanup();
  render(<SyncRestoreSettings {...props} document={{ privacy: { page_state_restore: false } }} />);
  expect(
    screen.getByRole("switch", { name: "Let agents finish restoring" }).hasAttribute("disabled"),
  ).toBe(true);
});
it("writes labeled mode changes and waits for server confirmation", async () => {
  await mount();
  await manage();
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
  await manage();
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
  await manage();
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
  expect(screen.getByLabelText("Misty password")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Turn on sync" })).toBeNull();
});
it("only offers creation after the server confirms vault absence", async () => {
  useBrowserSyncStore.setState({ session: null });
  mocks.availability.mockResolvedValue({ local: false, remote: false });
  await mount();
  expect(screen.getByRole("button", { name: "Turn on sync" })).toBeTruthy();
  expect(screen.getByLabelText("Misty password")).toBeTruthy();
  // Nothing is offered to unlock, reconnect or delete until the server says a vault exists.
  expect(screen.queryByRole("button", { name: "Unlock sync" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete vault" })).toBeNull();
});
it("locks sync and prevents background auto-unlock; forgetting removes the saved key", async () => {
  await mount();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Forget key" })));
  expect(mocks.lock).toHaveBeenCalledWith("s", true);
  expect(useBrowserSyncStore.getState().locked).toBe("a");
  expect(screen.getByLabelText("Misty password")).toBeTruthy();
});
it("deletes a locked vault after confirmation, then offers to create a new one", async () => {
  useBrowserSyncStore.setState({ session: null });
  mocks.availability.mockResolvedValue({ local: false, remote: true });
  mocks.deleteVault.mockResolvedValue(undefined);
  await mount();
  expect(screen.queryByRole("button", { name: "Turn on sync" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Delete vault" }));
  expect(mocks.deleteVault).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText("Misty password"), {
    target: { value: "my password" },
  });
  await act(async () =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete vault" })),
  );
  expect(mocks.deleteVault).toHaveBeenCalledTimes(1);
  // The credential derived from the password confirms it; the password itself is not passed on.
  expect(mocks.deleteVault).toHaveBeenCalledWith(
    { apiBase: "https://example.test", accountId: "a" },
    "credential:my password",
  );
  expect(screen.getByRole("button", { name: "Turn on sync" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete vault" })).toBeNull();
});
it("keeps the vault and shows why when resetting fails", async () => {
  mocks.deleteVault.mockRejectedValue(new Error("Could not reach the sync server."));
  await mount();
  await manage();
  fireEvent.click(screen.getByRole("button", { name: "Reset sync…" }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText("Misty password"), {
    target: { value: "my password" },
  });
  await act(async () =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete vault" })),
  );
  expect(within(dialog).getByRole("alert").textContent).toBe("Could not reach the sync server.");
  expect(useBrowserSyncStore.getState().session).toBeTruthy();
});
it("clears old-account forms when the account changes", async () => {
  useBrowserSyncStore.setState({ session: null });
  const view = render(<BrowserSyncSettings {...props} />);
  await waitFor(() => expect(screen.getByLabelText("Misty password")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Misty password"), {
    target: { value: "old account password" },
  });
  mocks.user = { id: "b", name: "Other" };
  mocks.generation++;
  await act(async () => view.rerender(<BrowserSyncSettings {...props} />));
  expect((screen.getByLabelText("Misty password") as HTMLInputElement).value).toBe("");
});

async function submitPasswordChange(current: string, next: string) {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Change password…" }));
  const dialog = screen.getByRole("dialog", { name: "Choose a new Misty password" });
  fireEvent.change(within(dialog).getByLabelText("Current password"), {
    target: { value: current },
  });
  fireEvent.change(within(dialog).getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(within(dialog).getByLabelText("Confirm new password"), {
    target: { value: next },
  });
  await act(async () =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Save password" })),
  );
  return dialog;
}
it("re-seals the open vault before changing the account password, and trusts the account only after both", async () => {
  mocks.user = { id: "a", name: "User", email: "a@example.test" };
  const order: string[] = [];
  mocks.reseal.mockImplementation(async () => void order.push("reseal"));
  mocks.changeAccountPassword.mockImplementation(async () => void order.push("account"));
  mocks.markCredential.mockImplementation(() => void order.push("mark"));
  await submitPasswordChange("the old one", "a brand new password");
  expect(order).toEqual(["reseal", "account", "mark"]);
  expect(mocks.reseal).toHaveBeenCalledWith(
    { apiBase: "https://example.test", accountId: "a" },
    "a@example.test",
    "a brand new password",
  );
  expect(mocks.changeAccountPassword).toHaveBeenCalledWith(
    "a@example.test",
    "the old one",
    "a brand new password",
  );
});
it("changes nothing on the server and trusts nothing when the vault could not be re-sealed", async () => {
  mocks.user = { id: "a", name: "User", email: "a@example.test" };
  mocks.reseal.mockRejectedValue(new Error("Unlock sync on this device first."));
  const dialog = await submitPasswordChange("the old one", "a brand new password");
  expect(mocks.changeAccountPassword).not.toHaveBeenCalled();
  expect(mocks.markCredential).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("alert").textContent).toContain("Unlock sync");
});
it("refuses to reuse the current password as the new one", async () => {
  mocks.user = { id: "a", name: "User", email: "a@example.test" };
  const dialog = await submitPasswordChange("same password here", "same password here");
  expect(mocks.reseal).not.toHaveBeenCalled();
  expect(mocks.changeAccountPassword).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("alert").textContent).toContain("not used before");
});
it("offers no password change while the vault exists but is locked", async () => {
  mocks.user = { id: "a", name: "User", email: "a@example.test" };
  useBrowserSyncStore.setState({ session: null });
  mocks.availability.mockResolvedValue({ local: true, remote: true, accountPassword: true });
  await mount();
  expect(screen.queryByRole("button", { name: "Change password…" })).toBeNull();
  expect(mocks.changeAccountPassword).not.toHaveBeenCalled();
});
it("forgets that the account is safe when the server says it has seen the password", async () => {
  mocks.me.mockResolvedValue({ provider: "misty", credential_account: false });
  await mount();
  await waitFor(() => expect(mocks.unmark).toHaveBeenCalledWith("a"));
});
it("leaves the account alone when the server confirms it holds only a credential", async () => {
  mocks.me.mockResolvedValue({ provider: "misty", credential_account: true });
  await mount();
  await waitFor(() => expect(mocks.me).toHaveBeenCalled());
  expect(mocks.unmark).not.toHaveBeenCalled();
});
it("asks for the password before deleting the vault, and says plainly when it is wrong", async () => {
  await mount();
  await manage();
  fireEvent.click(screen.getByRole("button", { name: "Reset sync…" }));
  const dialog = screen.getByRole("alertdialog");
  await act(async () =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete vault" })),
  );
  expect(within(dialog).getByRole("alert").textContent).toContain("Enter your Misty password");
  expect(mocks.deleteVault).not.toHaveBeenCalled();
  mocks.deleteVault.mockRejectedValueOnce("That password did not work. Check it.");
  fireEvent.change(within(dialog).getByLabelText("Misty password"), { target: { value: "wrong" } });
  await act(async () =>
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete vault" })),
  );
  expect(within(dialog).getByRole("alert").textContent).toBe("That password did not work.");
  expect(useBrowserSyncStore.getState().session).toBeTruthy();
});
