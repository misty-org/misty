import type { DirectorySizeRecord, FileEntry } from "@/native/contracts";
import { normalizeExplorerPath } from "@/shared/lib/pathNormalization";

export function directorySizeRecordForPath(
  directorySizes: Record<string, DirectorySizeRecord>,
  path: string,
): DirectorySizeRecord | undefined {
  return directorySizes[normalizeExplorerPath(path) || "/"];
}

export function entrySizeBytes(
  entry: FileEntry,
  directorySizes: Record<string, DirectorySizeRecord>,
): number | null {
  if (entry.kind !== "folder") return entry.sizeBytes;
  const record = directorySizeRecordForPath(directorySizes, entry.path);
  return record?.status === "ready" ? record.sizeBytes : null;
}
