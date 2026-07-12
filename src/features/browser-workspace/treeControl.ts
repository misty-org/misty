import type { NativeSyncView, SyncTreeView } from "./native";
import { deviceRows } from "./deviceControl";

export type TreeSeat = "you" | "other" | "free";

export interface TreeRow {
  deviceId: string;
  name: string;
  os: string;
  local: boolean;
  connection: string;
  /** Who is using this device's workspace right now. */
  seat: TreeSeat;
  seatName: string | null;
  canSwitch: boolean;
}

const osNames: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };

export function osLabel(platform: string, version?: string) {
  const name = osNames[platform] ?? platform;
  return [name, version].filter(Boolean).join(" ");
}

export function treeRows(
  session: NativeSyncView,
  trees: SyncTreeView,
  ownerName?: string | null,
): TreeRow[] {
  const rows = deviceRows(session, ownerName);
  const nameOf = (id: string) => rows.find((row) => row.device_id === id)?.name ?? "another device";
  return rows.map((row) => {
    const driver = trees.trees.find((tree) => tree.tree_id === row.device_id)?.driver_device_id;
    const seat: TreeSeat = !driver ? "free" : driver === session.device_id ? "you" : "other";
    return {
      deviceId: row.device_id,
      name: row.name,
      os: osLabel(row.platform, row.os_version),
      local: row.local,
      connection: row.connection,
      seat,
      // A device using its own workspace just reads "In use".
      seatName: driver && seat === "other" && driver !== row.device_id ? nameOf(driver) : null,
      canSwitch: seat !== "you" && row.full_sync && session.full_sync !== false,
    };
  });
}

export function seatText(row: TreeRow) {
  if (row.seat === "you") return row.local ? "In use here" : "Open on this device";
  if (row.seat === "other") return row.seatName ? `In use on ${row.seatName}` : "In use";
  return "Not in use";
}

/** Name of the other device whose workspace this device is showing, if any. */
export function viewingName(session: NativeSyncView, ownerName?: string | null): string | null {
  const trees = session.trees;
  if (!trees?.driving_tree || trees.driving_tree === session.device_id) return null;
  return (
    treeRows(session, trees, ownerName).find((row) => row.deviceId === trees.driving_tree)?.name ??
    null
  );
}

/** Whether this device must pick a workspace before continuing. */
export function mustChoose(session: NativeSyncView) {
  return Boolean(session.trees && session.trees.trees.length && !session.trees.driving_tree);
}
