import { deviceRows } from "./deviceControl";
import type { NativeSyncView } from "./native";

/** The control version at which a device understands pinned tabs. */
const pinnedTabsVersion = 3;

/**
 * Why pins can't be kept through sync, or null when they can. Mirrors the
 * sync worker's `pinned_tabs()` gate and names the devices holding it back
 * the way Settings › Devices does.
 */
export function pinnedTabsBlockedReason(
  session: NativeSyncView | null,
  ownerName?: string | null,
): string | null {
  const sync = session?.sync;
  if (!session || !sync || sync.pinned_tabs === true) return null;
  const outdated = new Set(
    (session.devices ?? [])
      .filter(
        (device) =>
          !device.revoked_at &&
          device.device_id !== session.device_id &&
          device.control_version < pinnedTabsVersion,
      )
      .map((device) => device.device_id),
  );
  const names = deviceRows(session, ownerName)
    .filter((row) => outdated.has(row.device_id))
    .map((row) => row.name);
  if (!names.length) return "Update Misty on your other devices to pin tabs.";
  // "A", "A and B", "A, B, and C" (Intl.ListFormat is outside the ES2020 lib).
  const list =
    names.length < 3
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `Update Misty on ${list} to pin tabs.`;
}
