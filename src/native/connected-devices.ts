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

export function connectedDevicesRoots(deviceId: string): Promise<PeerRoot[]> {
  return invoke("connected_devices_roots", { deviceId });
}

export function connectedDevicesMediaUrl(path: string): Promise<string> {
  return invoke("connected_devices_media_url", { path });
}

export function connectedDevicesPrepareClipboardFiles(deviceId: string): Promise<boolean> {
  return invoke("connected_devices_prepare_clipboard_files", { deviceId });
}
