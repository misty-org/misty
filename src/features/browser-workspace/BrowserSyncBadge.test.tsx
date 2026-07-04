import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { NativeSyncView } from "./native";
const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  read: vi.fn(),
  control: vi.fn(),
  activate: vi.fn(),
  generation: 1,
}));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: () => false,
  readApiSessionGeneration: () => mocks.generation,
}));
vi.mock("@/features/workspace/workspaceRecoveryPlatform", () => ({
  nativeWorkspaceRecoveryEnabled: () => true,
}));
vi.mock("@/features/workspace/nativeWorkspaceRecovery", () => ({
  useWorkspaceRecoveryState: create(() => ({
    accountId: "a",
    ready: true,
    usable: true,
    issue: null as string | null,
  })),
}));
vi.mock("@/features/workspace/useWorkspaceRecoveryRetry", () => ({
  retryWorkspaceRecovery: mocks.retry,
}));
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import { browserSyncRetryEvent, useBrowserSyncStore } from "./store";
vi.mock("./native", () => ({
  readNativeSync: mocks.read,
  activateNativeDevice: mocks.activate,
  controlNativeDevice: mocks.control,
}));
import { BrowserSyncBadge } from "./BrowserSyncBadge";
import { syncBadgeStatus } from "./syncBadgeStatus";
function session(): NativeSyncView {
  return {
    account_id: "a",
    session_id: "s",
    deployment: "https://example.test",
    device_id: "d",
    workspace_id: "w",
    profile_id: "p",
    browser_profile_ready: true,
    status: {
      phase: "ready",
      applied_sequence: 1,
      head_sequence: 1,
      pending_changes: 0,
      issue: null,
    },
    presence: [],
    pending_operation_ids: [],
    workspace: {
      version: 1,
      sequence: 1,
      active_device: null,
      records: [],
      resumes: {},
      orphaned_tab_ids: [],
      orphaned_website_ids: [],
    },
  };
}
function status(native = session()) {
  return syncBadgeStatus({
    accountId: "a",
    recovery: useWorkspaceRecoveryState.getState(),
    ...useBrowserSyncStore.getState(),
    session: native,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generation = 1;
  mocks.read.mockResolvedValue(null);
  mocks.control.mockResolvedValue("request");
  mocks.activate.mockResolvedValue("request");
  mocks.retry.mockResolvedValue(undefined);
  useWorkspaceRecoveryState.setState({ accountId: "a", ready: true, issue: null });
  useBrowserSyncStore.setState({ session: session(), issue: null, connecting: false });
});
afterEach(cleanup);
it("shows green for confirmed healthy sync and live work, with no warning outside the popover", () => {
  render(<BrowserSyncBadge accountId="a" onOpenSettings={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "Control: Up to date" }).getAttribute("data-sync-status"),
  ).toBe("green");
  expect(screen.queryByRole("dialog")).toBeNull();
  const pending = session();
  pending.status.pending_changes = 2;
  expect(status(pending)).toMatchObject({ tone: "green", title: "Syncing", spinning: true });
});
it.each(["offline", "attention", "stopped"] as const)(
  "shows red for %s even without an error message",
  (phase) => {
    const native = session();
    native.status.phase = phase;
    expect(status(native).tone).toBe("red");
  },
);
it("gives local save failures priority over a healthy cloud connection and opens retry details", async () => {
  useWorkspaceRecoveryState.setState({ issue: "Disk unavailable" });
  render(<BrowserSyncBadge accountId="a" onOpenSettings={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "Control: Local saving needs attention" });
  expect(trigger.getAttribute("data-sync-status")).toBe("red");
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Device control center" })).toBeTruthy();
  expect(screen.getByText(/may be lost if you close Misty/)).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry now" })));
  expect(mocks.retry).toHaveBeenCalledWith("a", expect.any(Function));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("does not show green for an unknown connection or another account", () => {
  const native = session();
  native.account_id = "b";
  expect(status(native)).toMatchObject({ tone: "neutral", title: "Sync is not connected" });
  native.account_id = "a";
  native.status.phase = "connecting";
  expect(status(native).tone).toBe("neutral");
});
it("shows profile failures as red and closes the popover before opening settings", () => {
  const native = session();
  native.browser_profile_issue = "Website storage unavailable";
  useBrowserSyncStore.setState({ session: native });
  const settings = vi.fn();
  render(<BrowserSyncBadge accountId="a" onOpenSettings={settings} />);
  fireEvent.click(screen.getByRole("button", { name: "Control: Sync needs attention" }));
  expect(screen.getByText("Website storage unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(settings).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("does not dispatch a cloud retry after an account change during local recovery", async () => {
  useWorkspaceRecoveryState.setState({ issue: "Disk unavailable" });
  let finish!: () => void;
  mocks.retry.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const request = vi.fn();
  window.addEventListener(browserSyncRetryEvent, request);
  render(<BrowserSyncBadge accountId="a" onOpenSettings={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Control: Local saving needs attention" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
  mocks.generation++;
  await act(async () => finish());
  expect(request).not.toHaveBeenCalled();
  window.removeEventListener(browserSyncRetryEvent, request);
});

it("shows independent mode instead of promising that a paused workspace is syncing", () => {
  const view = session();
  view.full_sync = false;
  view.status.pending_changes = 8;
  expect(status(view)).toMatchObject({
    title: "Independent workspace",
    spinning: false,
    websiteData: "Kept on this device",
  });
});

it("routes a remote switch and waits for signed activation rather than the HTTP reply", async () => {
  const view = session();
  view.devices = [
    {
      device_id: "d",
      display_name: "Local",
      platform: "macos",
      control_version: 1,
      full_sync: true,
    },
    {
      device_id: "remote",
      display_name: "Office",
      platform: "windows",
      control_version: 1,
      full_sync: true,
    },
  ];
  view.presence = [{ device_id: "remote", online: true, ready: true, applied_sequence: 1 }];
  view.workspace.active_device = { device_id: "d", epoch: "old", sequence: 1 };
  useBrowserSyncStore.setState({ session: view });
  render(<BrowserSyncBadge accountId="a" onOpenSettings={vi.fn()} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Control: Up to date" })),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Office" })));
  expect(mocks.control).toHaveBeenCalledWith("s", "remote", null, true);
  expect(screen.getByText("Switching…")).toBeTruthy();
  expect(
    screen.getByRole("switch", { name: "Full sync for Office" }).getAttribute("disabled"),
  ).not.toBeNull();
  act(() =>
    useBrowserSyncStore.setState({
      session: {
        ...view,
        workspace: {
          ...view.workspace,
          active_device: { device_id: "remote", epoch: "new", sequence: 2 },
        },
      },
    }),
  );
  expect(screen.queryByText("Switching…")).toBeNull();
  expect(screen.queryByRole("button", { name: "Switch to Office" })).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole("switch", { name: "Full sync for Office" })),
  );
  expect(mocks.control).toHaveBeenLastCalledWith("s", "remote", false, false);
  expect(screen.getByRole("status").textContent).toContain("Turning Full sync off…");
});
it("does not let a delayed device poll replace a new account's state", async () => {
  let resolve!: (value: NativeSyncView) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise<NativeSyncView>((done) => {
        resolve = done;
      }),
  );
  render(<BrowserSyncBadge accountId="a" onOpenSettings={vi.fn()} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Control: Up to date" })),
  );
  const other = { ...session(), account_id: "b", session_id: "other" };
  mocks.generation++;
  act(() => useBrowserSyncStore.setState({ session: other }));
  await act(async () => resolve(session()));
  expect(useBrowserSyncStore.getState().session).toBe(other);
});
