// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { listen as tauriListen } from "@tauri-apps/api/event";
import { invoke } from "@/native/invoke";
import { pickSaveFile } from "@/native/sandbox";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { NativePerformanceDiagnostics } from "./types";
import { getVersion } from "@tauri-apps/api/app";

/** The native side of the performance panel (`engine_config::metrics`). */
export const performanceApi = {
  enabled: () => invoke<boolean>("engine_performance_enabled"),
  setEnabled: (enabled: boolean) => invoke<boolean>("engine_performance_set_enabled", { enabled }),
  report: () => invoke<NativePerformanceDiagnostics>("engine_performance_report"),
  /** Asks where to save with the system's dialog; null when cancelled. */
  pickSavePath: (defaultName: string) =>
    pickSaveFile({ defaultName, filters: [{ name: "JSON", extensions: ["json"] }] }),
  /** Writes to the file just chosen in the save dialog, and nowhere else. */
  writeFile: (path: string, content: string) =>
    invoke<void>("engine_performance_export", { path, content }),
};

/** A native event, or nothing outside the app. */
export async function listen<T>(
  name: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (!hasTauriInternals()) return () => {};
  return tauriListen<T>(name, handler);
}

/** Misty's version, for the report. */
export async function appVersion(): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  return getVersion();
}
