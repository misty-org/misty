import type {
  ConnectedDevicesSnapshot,
  OpenWorkspaceRouteRequest,
  OpenWorkspaceRouteResult,
  PeerResponse,
  PeerRoot,
} from "@/native/contracts";
import { invoke } from "./invoke";

export function connectedDevicesInitialize(request: {
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
  deviceId: string;
  address: unknown;
  ticket: string;
}): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_connect", { request });
}

export function connectedDevicesOpenWorkspaceRoute(
  deviceId: string,
  request: OpenWorkspaceRouteRequest,
): Promise<OpenWorkspaceRouteResult> {
  return invoke("connected_devices_open_workspace_route", { deviceId, request });
}

export function connectedDevicesRoots(deviceId: string): Promise<PeerRoot[]> {
  return invoke("connected_devices_roots", { deviceId });
}

export function connectedDevicesListDirectory(request: {
  deviceId: string;
  path: string;
  showHidden?: boolean;
}): Promise<PeerResponse> {
  return invoke("connected_devices_list_directory", { request });
}

export function connectedDevicesReadFile(request: {
  deviceId: string;
  path: string;
  offset: number;
  length?: number | null;
  expectedSnapshot?: string | null;
}): Promise<number[]> {
  return invoke("connected_devices_read_file", { request });
}

export function connectedDevicesMediaUrl(path: string): Promise<string> {
  return invoke("connected_devices_media_url", { path });
}

export function connectedDevicesPrepareClipboardFiles(deviceId: string): Promise<boolean> {
  return invoke("connected_devices_prepare_clipboard_files", { deviceId });
}
