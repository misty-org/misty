import { ManagedAiRequestError } from "@/api/ai/managed";
import type { ChannelSnapshot, DevicePolicy } from "@/native/devices";

/** One of the account's devices, as the server lists it. Addresses are never
 * listed; presence comes from the device channel (docs/sync/devices.md). */
export interface AccountDevice {
  id: string;
  name: string;
  platform: string;
  publicKey: string;
  admissionState: "pending" | "admitted" | "revoked" | "legacy";
  osVersion: string;
  appVersion: string;
  approvedByDeviceId?: string;
  admittedAt?: string;
  lastSeenAt: string;
  createdAt: string;
  policy?: Omit<DevicePolicy, "version"> & { version: number; updatedAt: string };
}

export type DeviceStatus = "self" | "online" | "offline";

export interface DevicePeer extends AccountDevice {
  isSelf: boolean;
  online: boolean;
  status: DeviceStatus;
}

export function deviceStatusLabel(status: DeviceStatus): string {
  switch (status) {
    case "self":
      return "This device";
    case "online":
      return "Online";
    default:
      return "Offline";
  }
}

/** The account's added devices with their presence on the device channel. */
export function devicePeers(
  devices: AccountDevice[],
  selfId: string | null,
  channel: ChannelSnapshot | null,
): DevicePeer[] {
  return devices
    .filter((device) => device.admissionState === "admitted" || device.id === selfId)
    .map((device) => {
      const isSelf = device.id === selfId;
      const presence = channel?.peers.find((peer) => peer.deviceId === device.id);
      const online = isSelf || Boolean(presence?.online);
      const status: DeviceStatus = isSelf ? "self" : online ? "online" : "offline";
      return { ...device, isSelf, online, status };
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
