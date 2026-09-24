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
});
