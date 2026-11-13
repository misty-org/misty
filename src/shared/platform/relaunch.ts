import { invoke } from "@tauri-apps/api/core";

/** Starts Misty again: after an update, or on leaving a server. Only the main workspace may ask. */
export function relaunch(): Promise<void> {
  return invoke("app_relaunch");
}
