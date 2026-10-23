import type { NativeSyncView, SyncDeviceInfo } from "./native";
import { deviceLabels } from "./deviceNames";
import { currentDeviceId } from "./websiteData";

export function deviceRows(session: NativeSyncView, ownerName?: string | null) {
  const revoked = new Set(
    (session.devices ?? []).filter((device) => device.revoked_at).map((device) => device.device_id),
  );
  const roster = new Map<string, SyncDeviceInfo>();
  for (const device of session.devices ?? []) {
    if (!device.revoked_at) roster.set(device.device_id, device);
  }
  for (const presence of session.presence) {
    if (!revoked.has(presence.device_id) && !roster.has(presence.device_id))
      roster.set(presence.device_id, {
        device_id: presence.device_id,
        display_name: "",
        platform: "",
        control_version: 0,
        full_sync: true,
      });
  }
  if (!roster.has(session.device_id))
    roster.set(session.device_id, {
      device_id: session.device_id,
      display_name: "",
      platform: "",
      control_version: 0,
      full_sync: session.full_sync !== false,
    });
  const connected = session.status.phase === "ready" || session.status.phase === "catching_up";
  const labels = deviceLabels([...roster.values()], ownerName);
  return [...roster.values()]
    .map((device) => {
      const local = device.device_id === session.device_id;
      const presence = session.presence.find((item) => item.device_id === device.device_id);
      return {
        ...device,
        local,
        name: labels.get(device.device_id) ?? "Device",
        connection: !connected
          ? "Unknown"
          : local || presence?.online
            ? "Connected"
            : presence
              ? "Offline"
              : "Unknown",
        active: device.full_sync && session.workspace.active_device?.device_id === device.device_id,
      };
    })
    .sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
}

/** Use authoritative publisher identity, never presence or a viewed workspace’s name. */
export function publishingDeviceId(session: NativeSyncView): string | null {
  if (session.sync)
    return (
      session.sync.workspaces.find(
        (workspace) => workspace.workspace_id === currentDeviceId(session),
      )?.driver_device_id ?? null
    );
  return session.workspace.active_device?.device_id ?? null;
}
