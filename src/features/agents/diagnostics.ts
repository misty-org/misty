import { invoke } from "@tauri-apps/api/core";

/** Development builds only: one line into the desktop log, for timing agent work in evals. */
export function diag(scope: string, message: string): void {
  if (!import.meta.env.DEV) return;
  void invoke("diagnostic_log", { scope, message }).catch(() => undefined);
}
