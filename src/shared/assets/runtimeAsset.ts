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
  return runtimeAssetSource(assetsDir, relativePath);
}

export function runtimeAssetSource(
  assetsDir: string | null | undefined,
  relativePath: string,
): string {
  const base = assetsDir?.trim().replace(/[\\/]+$/, "");
  const relative = relativePath.trim().replace(/^[\\/]+/, "");
  if (!base || !relative || !isAbsoluteRuntimeAssetsDirectory(base)) return "";
  const separator = base.includes("\\") ? "\\" : "/";
  const normalizedRelative = relative.replace(/[\\/]+/g, separator);
  return safeTauriAssetUrl(`${base}${separator}${normalizedRelative}`);
}

function isAbsoluteRuntimeAssetsDirectory(path: string): boolean {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return false;
  return path.startsWith("/") || path.startsWith("\\\\") || /^[a-z]:[\\/]/i.test(path);
}

export function hideRuntimeAssetOnError(
  event: SyntheticEvent<HTMLImageElement>,
): void {
  event.currentTarget.style.visibility = "hidden";
}

export function revealRuntimeAssetOnLoad(
  event: SyntheticEvent<HTMLImageElement>,
): void {
  event.currentTarget.style.visibility = "";
}
