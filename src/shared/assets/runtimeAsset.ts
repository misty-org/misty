import { safeTauriAssetUrl } from "../tauri";
import type { SyntheticEvent } from "react";

const runtimeAssetPrefix = "misty-runtime-asset:";

export function runtimeAssetReference(relativePath: string): string {
  return `${runtimeAssetPrefix}${relativePath.trim().replace(/^[\\/]+/, "")}`;
}

export function runtimeAssetPath(reference: string): string | null {
  if (!reference.startsWith(runtimeAssetPrefix)) return null;
  return reference.slice(runtimeAssetPrefix.length);
}

export function resolveRuntimeAssetReference(
  reference: string,
  assetsDir: string | null | undefined,
): string {
  const relativePath = runtimeAssetPath(reference);
  if (relativePath === null) return reference;
  return runtimeAssetSource(
    assetsDir,
    relativePath,
    "",
  );
}

export function runtimeAssetSource(
  assetsDir: string | null | undefined,
  relativePath: string,
  fallback: string,
): string {
  const base = assetsDir?.trim().replace(/[\\/]+$/, "");
  const relative = relativePath.trim().replace(/^[\\/]+/, "");
  if (!base || !relative || !isAbsoluteRuntimeAssetsDirectory(base)) return fallback;
  return safeTauriAssetUrl(`${base}/${relative}`);
}

function isAbsoluteRuntimeAssetsDirectory(path: string): boolean {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return false;
  return path.startsWith("/") || path.startsWith("\\\\") || /^[a-z]:[\\/]/i.test(path);
}

export function restoreBundledAssetOnError(
  event: SyntheticEvent<HTMLImageElement>,
  fallback: string,
): void {
  const image = event.currentTarget;
  if (image.dataset.bundledFallbackApplied === "true") return;
  image.dataset.bundledFallbackApplied = "true";
  image.src = fallback;
}
