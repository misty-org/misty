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

export type TauriInternals = {
  convertFileSrc?: (filePath: string, protocol?: string) => string;
  invoke?: unknown;
};
