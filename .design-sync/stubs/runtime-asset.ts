// design-sync stub for @/platform/runtimeAsset
//
// Runtime asset resolution depends on the app shell's on-disk assets dir, which
// design previews don't have. Returning no resolved source makes AssetIcon fall
// back to its built-in lucide icons — a faithful preview of the component's
// graceful-degradation path. `runtimeAssetPath` still echoes the reference so
// AssetIcon's name-based fallback picker chooses a sensible icon.
export function resolveRuntimeAssetReference(
  _reference: string | undefined,
  _assetsDir?: string,
): string | undefined {
  return undefined;
}

export function runtimeAssetPath(reference: string): string | null {
  return typeof reference === "string" ? reference : null;
}
