import type { DeviceSnapshot, DirectoryListing, ListDirectoryRequest } from "@/native/ipc";
import { invoke } from "@tauri-apps/api/core";

// The read-only folder listing behind Misty's file picker. Managing files
// happens in Kura, a separate app.
export * from "@/native/runtime";
export * from "@/native/settings-plugins";
export function devicesSnapshot(): Promise<DeviceSnapshot> {
  return invoke("devices_snapshot");
}
export function explorerListDirectory(request: ListDirectoryRequest): Promise<DirectoryListing> {
  return invoke("explorer_list_directory", {
    request,
  });
}
