import type { NativeSyncView, SyncState } from "./native";
import { deviceRows } from "./deviceControl";

export type WorkspaceSeat = "you" | "other" | "free";

export interface WorkspaceRow {
  deviceId: string;
  name: string;
  os: string;
  local: boolean;
  connection: string;
  /** This machine shows and edits this workspace now. */
  current: boolean;
  /** Who holds this workspace's sign-in lease. Not a lock: any machine may open it. */
  seat: WorkspaceSeat;
  seatName: string | null;
  canSwitch: boolean;
}

const osNames: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };

/** A device with no presence entry is treated as live; one reported offline is not. */
export function deviceIsLive(session: NativeSyncView, deviceId: string) {
  if (deviceId === session.device_id) return true;
  return session.presence.find((item) => item.device_id === deviceId)?.online ?? true;
}

export function osLabel(platform: string, version?: string) {
  const name = osNames[platform] ?? platform;
  return [name, version].filter(Boolean).join(" ");
}

export function workspaceRows(
  session: NativeSyncView,
  state: SyncState,
  ownerName?: string | null,
): WorkspaceRow[] {
  const rows = deviceRows(session, ownerName);
  const shown = onWorkspace(session);
  const nameOf = (id: string) => rows.find((row) => row.device_id === id)?.name ?? "another device";
  return rows.map((row) => {
    const driver = state.workspaces.find(
      (workspace) => workspace.workspace_id === row.device_id,
    )?.driver_device_id;
    // A seat held by a device that is no longer connected is free, not "in use".
    const seat: WorkspaceSeat =
      !driver || !deviceIsLive(session, driver)
        ? "free"
        : driver === session.device_id
          ? "you"
          : "other";
    return {
      deviceId: row.device_id,
      name: row.name,
      os: osLabel(row.platform, row.os_version),
      local: row.local,
      connection: row.connection,
      current: row.device_id === shown,
      seat,
      // A device using its own workspace just reads "In use".
      seatName: driver && seat === "other" && driver !== row.device_id ? nameOf(driver) : null,
      canSwitch: row.device_id !== shown && row.full_sync && session.full_sync !== false,
    };
  });
}

/** The workspace this machine shows and edits. */
export function onWorkspace(session: NativeSyncView): string | null {
  const state = session.sync;
  return state ? (state.on_workspace ?? state.driving_workspace) : null;
}
