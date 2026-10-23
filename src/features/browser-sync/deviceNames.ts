import type { SyncDeviceInfo } from "./native";

const kinds: Record<string, string> = { macos: "Mac", windows: "PC", linux: "Linux PC" };

/**
 * Names shown for devices. A name the user chose wins; otherwise
 * "<first name>'s <Mac|PC> <n>", numbered in enrollment order among unnamed
 * devices of the same kind (no number when there is only one).
 */
export function deviceLabels(devices: SyncDeviceInfo[], ownerName?: string | null) {
  const first = ownerName?.trim().split(/\s+/)[0];
  const owner = first ? `${first}’s` : "My";
  const ordered = [...devices].sort(
    (a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
      a.device_id.localeCompare(b.device_id),
  );
  const unnamed = new Map<string, SyncDeviceInfo[]>();
  for (const device of ordered) {
    if ((device.display_name ?? "").trim()) continue;
    const kind = kinds[device.platform] ?? "device";
    unnamed.set(kind, [...(unnamed.get(kind) ?? []), device]);
  }
  const labels = new Map<string, string>();
  for (const device of ordered) {
    const custom = (device.display_name ?? "").trim();
    if (custom) {
      labels.set(device.device_id, custom);
      continue;
    }
    const kind = kinds[device.platform] ?? "device";
    const peers = unnamed.get(kind) ?? [];
    const number = peers.length > 1 ? ` ${peers.indexOf(device) + 1}` : "";
    labels.set(device.device_id, `${owner} ${kind}${number}`);
  }
  return labels;
}
