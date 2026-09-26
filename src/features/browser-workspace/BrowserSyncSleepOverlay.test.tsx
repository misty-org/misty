import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeSyncView } from "./native";
const mocks = vi.hoisted(() => ({ activate: vi.fn(), read: vi.fn(), suspend: vi.fn() }));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: mocks.suspend,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: () => false,
  readApiSessionGeneration: () => 1,
}));
vi.mock("./native", () => ({
  activateNativeDevice: mocks.activate,
  readNativeSync: mocks.read,
  activeDeviceEpoch: (s: NativeSyncView) =>
    s.workspace.active_device?.device_id === s.device_id ? s.workspace.active_device.epoch : null,
}));
import { BrowserSyncSleepOverlay } from "./BrowserSyncSleepOverlay";
import { useBrowserSyncStore } from "./store";
function session(): NativeSyncView {
  return {
    session_id: "session",
    account_id: "account",
    device_id: "here",
    deployment: "",
    workspace_id: "",
    profile_id: "",
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
      active_device: { device_id: "there", epoch: "old", sequence: 1 },
      records: [],
      resumes: {},
      orphaned_tab_ids: [],
      orphaned_website_ids: [],
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  useBrowserSyncStore.setState({ session: session() });
});
afterEach(cleanup);
describe("sleeping device", () => {
  it("waits for server confirmation and prevents duplicate clicks or escape dismissal", async () => {
    mocks.activate.mockResolvedValue("claim");
    mocks.read.mockResolvedValue({ ...session(), pending_operation_ids: ["claim"] });
    render(<BrowserSyncSleepOverlay accountId="account" />);
    expect(mocks.suspend).toHaveBeenCalledWith(true, "device-sync-sleep");
    const wake = screen.getByRole("button", { name: "Wake Misty and use this device" });
    await act(async () => {
      fireEvent.click(wake);
      fireEvent.click(wake);
    });
    expect(mocks.activate).toHaveBeenCalledTimes(1);
    expect(mocks.activate).toHaveBeenCalledWith("session");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(wake, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    const active = session();
    active.workspace.active_device = { device_id: "here", epoch: "claim", sequence: 2 };
    active.workspace.sequence = 2;
    await act(async () => useBrowserSyncStore.setState({ session: active }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.suspend).toHaveBeenCalledWith(false, "device-sync-sleep");
  });
  it("keeps followers covered on failure and lets the sprite retry", async () => {
    mocks.activate.mockRejectedValue(new Error("Waiting for connection"));
    render(<BrowserSyncSleepOverlay accountId="account" />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("alert").textContent).toBe("Waiting for connection");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
  it("never covers a different account", () => {
    render(<BrowserSyncSleepOverlay accountId="different" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.suspend).not.toHaveBeenCalled();
  });
  it("keeps local browsing usable when website sign-in recovery fails", () => {
    useBrowserSyncStore.setState({
      session: { ...session(), browser_profile_issue: "Could not verify browser sign-in storage." },
    });
    render(<BrowserSyncSleepOverlay accountId="account" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.suspend).not.toHaveBeenCalled();
  });
  it.each(["connecting", "offline", "attention", "stopped"] as const)(
    "keeps local browsing usable while sync is %s",
    (phase) => {
      const view = session();
      view.status.phase = phase;
      useBrowserSyncStore.setState({ session: view });
      render(<BrowserSyncSleepOverlay accountId="account" />);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mocks.suspend).not.toHaveBeenCalled();
    },
  );
  it("does not treat an unselected or partially received startup workspace as another active device", () => {
    const view = session();
    view.workspace.active_device = null;
    useBrowserSyncStore.setState({ session: view });
    const rendered = render(<BrowserSyncSleepOverlay accountId="account" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() =>
      useBrowserSyncStore.setState({
        session: {
          ...view,
          workspace: {
            ...view.workspace,
            active_device: { device_id: null, epoch: "cleared", sequence: 2 },
          },
        },
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const pending = session();
    pending.status.head_sequence = 5;
    act(() => useBrowserSyncStore.setState({ session: pending }));
    rendered.rerender(<BrowserSyncSleepOverlay accountId="account" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.suspend).not.toHaveBeenCalled();
  });
});

it("keeps independent devices usable even while another device is active", () => {
  useBrowserSyncStore.setState({ session: { ...session(), full_sync: false } });
  render(<BrowserSyncSleepOverlay accountId="account" />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.suspend).not.toHaveBeenCalledWith(true, "device-sync-sleep");
});
