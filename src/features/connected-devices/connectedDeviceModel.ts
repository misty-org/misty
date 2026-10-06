import { ManagedAiRequestError } from "@/features/agents/devices";
import type { ChannelSnapshot, DevicePolicy } from "@/native/devices";

/** One of the account's devices, as the server lists it. Addresses are never
 * listed; presence comes from the device channel (docs/design/devices/BRIEF.md). */
export interface AccountDevice {
  id: string;
  name: string;
  platform: string;
  publicKey: string;
  p2pEndpointId?: string;
  admissionState: "pending" | "admitted" | "revoked" | "legacy";
  osVersion: string;
  appVersion: string;
  approvedByDeviceId?: string;
  admittedAt?: string;
  lastSeenAt: string;
  createdAt: string;
  policy?: Omit<DevicePolicy, "version"> & { version: number; updatedAt: string };
}

export type DeviceStatus = "self" | "same-network" | "other-network" | "offline" | "unreachable";

export interface DevicePeer extends AccountDevice {
  isSelf: boolean;
  online: boolean;
  connected: boolean;
  status: DeviceStatus;
}

export function deviceStatusLabel(status: DeviceStatus): string {
  switch (status) {
    case "self":
      return "This device";
    case "same-network":
      return "Same network";
    case "other-network":
      return "Other network";
    case "unreachable":
      return "Can't reach";
    default:
      return "Offline";
  }
}

/** The account's added devices with what this device knows of each now. */
export function devicePeers(
  devices: AccountDevice[],
  selfId: string | null,
  channel: ChannelSnapshot | null,
  connected: string[],
  unreachable: ReadonlySet<string>,
): DevicePeer[] {
  return devices
    .filter((device) => device.admissionState === "admitted" || device.id === selfId)
    .map((device) => {
      const isSelf = device.id === selfId;
      const presence = channel?.peers.find((peer) => peer.deviceId === device.id);
      const online = isSelf || Boolean(presence?.online);
      const isConnected = connected.includes(device.id);
      const sameNetwork =
        Boolean(presence) &&
        ((Boolean(channel?.networkKey) && presence?.networkKey === channel?.networkKey) ||
          (Boolean(channel?.overlay) && Boolean(presence?.overlay)));
      const status: DeviceStatus = isSelf
        ? "self"
        : !online
          ? "offline"
          : isConnected || sameNetwork
            ? "same-network"
            : unreachable.has(device.id)
              ? "unreachable"
              : "other-network";
      return { ...device, isSelf, online, connected: isConnected, status };
    })
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name));
}

export function connectedDevicesErrorMessage(cause: unknown): string {
  if (cause instanceof ManagedAiRequestError) {
    if (cause.status === 503) return "Your devices are temporarily unavailable.";
    // Cloudflare edge failures (e.g. 1033: tunnel offline) arrive as a bare
    // "error code: NNNN" body. That means the server is unreachable, not broken.
    if (cause.status === 530 || /^error code: \d+$/i.test(cause.message.trim())) {
      return "Can’t reach the Misty server right now. Misty will keep retrying.";
    }
  }
  return cause instanceof Error ? cause.message : String(cause || "Your devices are unavailable.");
}

export function connectedDevicePlatform(): "macos" | "windows" | "linux" | "unknown" {
  const value = navigator.userAgent.toLowerCase();
  if (value.includes("mac")) return "macos";
  if (value.includes("win")) return "windows";
  if (value.includes("linux")) return "linux";
  return "unknown";
}
