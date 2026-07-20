import type { TauriInternals } from "@/models/types/platform/tauri";
export type { TauriInternals } from "@/models/types/platform/tauri";
export function getTauriInternals(): TauriInternals | null {
  if (typeof window === "undefined") return null;
  return (
    (window as typeof window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__ ?? null
  );
}

export function hasTauriInternals(): boolean {
  return typeof getTauriInternals()?.invoke === "function";
}

export function safeTauriAssetUrl(path: string): string {
  const internals = getTauriInternals();
  if (internals?.convertFileSrc) {
    return internals.convertFileSrc(path);
  }
  return path;
}
