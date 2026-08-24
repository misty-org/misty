import type { ConnectedDevicesSnapshot, PeerRoot } from "@/native/ipc";
import { invoke } from "./invoke";

export function connectedDevicesInitialize(request: {
  instance?: string;
  accountId: string;
  deviceId: string;
  deviceName?: string;
  developmentTicketKeys?: Record<string, string>;
}): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_initialize", { request });
}

export function connectedDevicesSnapshot(): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_snapshot");
}

export function connectedDevicesSubscribeDirectory(path: string): Promise<void> {
  return invoke("connected_devices_subscribe_directory", { path });
}

export function connectedDevicesConnect(request: {
  instance?: string;
  deviceId: string;
  address: unknown;
  ticket: string;
}): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_connect", { request });
}

/** This device's server id, which paired devices know it by. */
export function connectedDevicesSetIdentity(deviceId: string): Promise<void> {
  return invoke("connected_devices_set_identity", { deviceId });
}

export interface PairConsent {
  deviceId: string;
  /** The device may change files on this device. */
  acceptsWrites: boolean;
  /** This device sends its clipboard to the device and accepts the device's. */
  sharesClipboard: boolean;
}

/** Every paired device and this device's consent toward it. Kept on the device,
 * so it holds while Misty's server is unreachable; unlisted devices lose their
 * sessions. */
export function connectedDevicesSyncPairs(pairs: PairConsent[]): Promise<void> {
  return invoke("connected_devices_sync_pairs", { pairs });
}

/** How many days a session lasts after an explicit connect. */
export function connectedDevicesConfigure(sessionDays: number): Promise<void> {
  return invoke("connected_devices_configure", { sessionDays });
}

/** Reconnects sessions that have no live connection, without Misty's server. */
export function connectedDevicesResumeSessions(
  addresses: Record<string, unknown>,
): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_resume_sessions", { addresses });
}

/** Ends the session with a device on both sides. The pair stays. */
export function connectedDevicesEndSession(deviceId: string): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_end_session", { deviceId });
}

export function connectedDevicesRoots(deviceId: string): Promise<PeerRoot[]> {
  return invoke("connected_devices_roots", { deviceId });
}

export function connectedDevicesMediaUrl(path: string): Promise<string> {
  return invoke("connected_devices_media_url", { path });
}

export function connectedDevicesPrepareClipboardFiles(deviceId: string): Promise<boolean> {
  return invoke("connected_devices_prepare_clipboard_files", { deviceId });
}
