import type { ConnectedDevicesSnapshot } from "@/native/ipc";
import { invoke } from "./invoke";

export function connectedDevicesInitialize(request: {
  instance?: string;
  accountId: string;
  deviceId: string;
  deviceName?: string;
}): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_initialize", { request });
}

export function connectedDevicesSnapshot(): Promise<ConnectedDevicesSnapshot> {
  return invoke("connected_devices_snapshot");
}

/** This device's server id, which its other devices know it by. */
export function connectedDevicesSetIdentity(deviceId: string): Promise<void> {
  return invoke("connected_devices_set_identity", { deviceId });
}
