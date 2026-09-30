import { expect, it } from "vitest";
import type { NativeSyncView, SyncState } from "./native";
import { seatText, workspaceRows, viewingName } from "./workspaceControl";

const device = (id: string, name: string, platform = "macos") => ({
  device_id: id,
  display_name: name,
  created_at: null,
  platform,
  os_version: platform === "macos" ? "15.1" : "",
  control_version: 1,
  full_sync: true,
});

function session(driving: string | null, drivers: Record<string, string | null>): NativeSyncView {
  const state: SyncState = {
    device_id: "a",
    shared_workspace_id: "w",
    driving_workspace: driving,
    workspaces: Object.entries(drivers).map(([workspace_id, driver]) => ({
      workspace_id,
      shared: false,
      driver_device_id: driver,
      driver_epoch: driver ? "e" : null,
      driver_seen_at: null,
      version: 1,
    })),
    contents: {},
    pending: [],
    displaced_with_edits: false,
  };
  return {
    session_id: "s",
    deployment: "d",
    account_id: "acct",
    vault_id: "w",
    device_id: "a",
    profile_id: "p",
    status: {
      phase: "ready",
      applied_sequence: 1,
      head_sequence: 1,
      pending_changes: 0,
      issue: null,
    },
    devices: [device("a", "MacBook"), device("b", "Windows PC", "windows"), device("c", "Studio")],
    presence: [],
    workspace: {
      version: 1,
      sequence: 1,
      records: [],
      orphaned_view_ids: [],
      orphaned_bookmark_ids: [],
      resumes: {},
    },
    pending_operation_ids: [],
    sync: state,
  } as NativeSyncView;
}

it("describes who uses each device's workspace", () => {
  const view = session("b", { a: null, b: "a", c: "b" });
  const rows = workspaceRows(view, view.sync!);
  const row = (id: string) => rows.find((r) => r.deviceId === id)!;
  expect(seatText(row("a"))).toBe("Not in use");
  expect(row("b").seat).toBe("you");
  expect(row("b").canSwitch).toBe(false);
  expect(seatText(row("c"))).toBe("In use on Windows PC");
  expect(row("a").name).toBe("MacBook");
  expect(row("b").os).toBe("Windows");
  expect(row("a").os).toBe("macOS 15.1");
  expect(viewingName(view)).toBe("Windows PC");
});

it("asks a device without a seat to choose", () => {
  expect(viewingName(session("a", { a: "a" }))).toBeNull();
});

it("a device using its own workspace reads just In use", () => {
  const view = session("a", { a: "a", c: "c" });
  expect(seatText(workspaceRows(view, view.sync!).find((r) => r.deviceId === "c")!)).toBe("In use");
});

it("marks the workspace this machine is on, not the lease it holds", () => {
  // This machine holds its own lease but opened Studio's tabs; Studio keeps its lease.
  const view = session("a", { a: "a", c: "c" });
  view.sync!.on_workspace = "c";
  const rows = workspaceRows(view, view.sync!);
  const row = (id: string) => rows.find((r) => r.deviceId === id)!;
  expect(row("c").current).toBe(true);
  expect(row("c").canSwitch).toBe(false);
  expect(seatText(row("c"))).toBe("Open on this device");
  expect(row("a").current).toBe(false);
  expect(row("a").canSwitch).toBe(true);
});
