import { invoke } from "@tauri-apps/api/core";

export function relaunch(): Promise<void> {
  return invoke("app_relaunch");
}
