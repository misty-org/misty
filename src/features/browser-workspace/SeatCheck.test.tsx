import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeSyncView, SyncTreeView } from "./native";
const mocks = vi.hoisted(() => ({ suspend: vi.fn() }));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: mocks.suspend,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: () => false,
  readApiSessionGeneration: () => 1,
}));
vi.mock("./native", () => ({ claimNativeTree: vi.fn(), readNativeSync: vi.fn() }));
import { DeviceChooseOverlay, SEAT_CHECK_GRACE_MS } from "./DeviceChooseOverlay";
import { browserSyncRetryEvent, useBrowserSyncStore } from "./store";
import { seatUnconfirmed } from "./treeControl";

function trees(confirmed: boolean): SyncTreeView {
  return {
    device_id: "here",
    shared_tree_id: "shared",
    driving_tree: "here",
    trees: [
      {
        tree_id: "here",
        shared: false,
        driver_device_id: "here",
        driver_epoch: "e",
        driver_seen_at: null,
        version: 1,
      },
    ],
    workspaces: {},
    pending: [],
    displaced_with_edits: false,
    seat_confirmed: confirmed,
  };
}

function session(phase: NativeSyncView["status"]["phase"], confirmed: boolean): NativeSyncView {
  return {
    session_id: "session",
    account_id: "account",
    device_id: "here",
    deployment: "",
    workspace_id: "",
    profile_id: "",
    status: { phase, applied_sequence: 1, head_sequence: 1, pending_changes: 0, issue: null },
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
    trees: trees(confirmed),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("treats a remembered seat as unproven until the server confirms it", () => {
  expect(seatUnconfirmed(session("ready", true))).toBe(false);
  expect(seatUnconfirmed(session("offline", false))).toBe(true);
  // Natives that predate confirmation keep their previous behavior.
  const legacy = session("ready", true);
  delete legacy.trees!.seat_confirmed;
  expect(seatUnconfirmed(legacy)).toBe(false);
});

it("pauses a stopped device at once, since it can never confirm its seat", () => {
  useBrowserSyncStore.setState({ session: session("attention", false), connecting: false });
  render(<DeviceChooseOverlay accountId="account" />);
  expect(screen.getByText("Checking who’s using this workspace")).toBeTruthy();
  expect(mocks.suspend).toHaveBeenCalledWith(true, "device-sync-choose");
  const retry = vi.fn();
  window.addEventListener(browserSyncRetryEvent, retry);
  fireEvent.click(screen.getByRole("button", { name: "Reconnect now" }));
  window.removeEventListener(browserSyncRetryEvent, retry);
  expect((retry.mock.calls[0][0] as CustomEvent).detail).toBe("account");
});

it("lets brief disconnects pass, then pauses until the seat is confirmed", async () => {
  useBrowserSyncStore.setState({ session: session("offline", false), connecting: false });
  render(<DeviceChooseOverlay accountId="account" />);
  expect(screen.queryByText("Checking who’s using this workspace")).toBeNull();
  await act(async () => vi.advanceTimersByTime(SEAT_CHECK_GRACE_MS));
  expect(screen.getByText("Checking who’s using this workspace")).toBeTruthy();
  await act(async () => useBrowserSyncStore.setState({ session: session("ready", true) }));
  expect(screen.queryByText("Checking who’s using this workspace")).toBeNull();
  expect(mocks.suspend).toHaveBeenLastCalledWith(false, "device-sync-choose");
});
