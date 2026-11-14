import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "./tauri";

/** Calls a native command, failing plainly outside the Misty app (a web preview, a test). */
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriInternals()) {
    return Promise.reject(
      new Error(`Native command "${command}" is only available in the Misty app runtime.`),
    );
  }
  return tauriInvoke<T>(command, args);
}
