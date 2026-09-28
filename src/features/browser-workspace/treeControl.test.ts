import { expect, it } from "vitest";
import type { NativeSyncView, SyncTreeView } from "./native";
import { mustChoose, seatText, treeRows, viewingName } from "./treeControl";

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
  const trees: SyncTreeView = {
    device_id: "a",
    shared_tree_id: "w",
    driving_tree: driving,
    trees: Object.entries(drivers).map(([tree_id, driver]) => ({
      tree_id,
      shared: false,
      driver_device_id: driver,
      driver_epoch: driver ? "e" : null,
      driver_seen_at: null,
      version: 1,
    })),
    workspaces: {},
    pending: [],
    displaced_with_edits: false,
  };
  return {
    session_id: "s",
    deployment: "d",
    account_id: "acct",
    workspace_id: "w",
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
      orphaned_tab_ids: [],
      orphaned_website_ids: [],
      resumes: {},
    },
    pending_operation_ids: [],
    trees,
  } as NativeSyncView;
}

it("describes who uses each device's workspace", () => {
  const view = session("b", { a: null, b: "a", c: "b" });
  const rows = treeRows(view, view.trees!);
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
  expect(mustChoose(session(null, { a: "b", b: "b" }))).toBe(true);
  expect(mustChoose(session("a", { a: "a" }))).toBe(false);
  expect(viewingName(session("a", { a: "a" }))).toBeNull();
});

it("a device using its own workspace reads just In use", () => {
  const view = session("a", { a: "a", c: "c" });
  expect(seatText(treeRows(view, view.trees!).find((r) => r.deviceId === "c")!)).toBe("In use");
});
