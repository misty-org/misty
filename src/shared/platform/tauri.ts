function getTauriInternals(): TauriInternals | null {
  if (typeof window === "undefined") return null;
  return (
    (window as typeof window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__ ?? null
  );
}

export function hasTauriInternals(): boolean {
  return typeof getTauriInternals()?.invoke === "function";
}

/** `path` as a URL of Tauri's asset protocol, or of another of Misty's protocols (`protocol`). */
export function safeTauriAssetUrl(path: string, protocol?: string): string {
  const internals = getTauriInternals();
  if (internals?.convertFileSrc) {
    return internals.convertFileSrc(path, protocol);
  }
  return path;
}

type TauriInternals = {
  convertFileSrc?: (filePath: string, protocol?: string) => string;
  invoke?: unknown;
};
