// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { listen as tauriListen } from "@tauri-apps/api/event";
import { invoke } from "@/native/invoke";
import { pickSaveFile } from "@/native/sandbox";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { NativePerformanceDiagnostics } from "./types";
import { getVersion } from "@tauri-apps/api/app";

export const performanceApi = {
  enabled: () => invoke<boolean>("engine_performance_enabled"),
  setEnabled: (enabled: boolean) => invoke<boolean>("engine_performance_set_enabled", { enabled }),
  report: () => invoke<NativePerformanceDiagnostics>("engine_performance_report"),
  pickSavePath: (defaultName: string) =>
    pickSaveFile({ defaultName, filters: [{ name: "JSON", extensions: ["json"] }] }),
  writeFile: (path: string, content: string) =>
    invoke<void>("engine_performance_export", { path, content }),
};

export async function listen<T>(
  name: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (!hasTauriInternals()) return () => {};
  return tauriListen<T>(name, handler);
}

export async function appVersion(): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  return getVersion();
}
