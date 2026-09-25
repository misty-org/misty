import type { ArchiveEntry } from "@/native/contracts";
import { formatBytes } from "../../utils/fileFormat";
import { archivePreviewExtensions } from "./previewConstants";

export function archiveEntryName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).pop() ?? path;
}

export function archiveEntryIsArchive(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return [...archivePreviewExtensions].some((extension) => lowerPath.endsWith(`.${extension}`));
}

export function formatArchiveEntrySize(entry: ArchiveEntry): string {
  const size = entry.uncompressedSize || entry.compressedSize;
  return size > 0 ? formatBytes(size) : "";
}
