import { safeTauriAssetUrl } from "@/shared/platform/tauri";

export async function readLocalFileFromPath(path: string, filename: string): Promise<File> {
  const response = await fetch(safeTauriAssetUrl(path));
  if (!response.ok) {
    throw new Error(`Could not read file at ${path}`);
  }
  const blob = await response.blob();
  return new File([blob], filename, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}
