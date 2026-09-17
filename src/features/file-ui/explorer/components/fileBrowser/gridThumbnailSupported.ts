import type { FileEntry } from "@/native/contracts";
const gridThumbnailImageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "tga",
  "hdr",
  "pic",
  "pbm",
  "pgm",
  "pnm",
  "ppm",
  "psd",
]);

export function gridThumbnailSupported(entry: FileEntry): boolean {
  if (entry.kind === "folder" || entry.kind === "symlink" || entry.isDeleted) return false;
  if (entry.location.kind === "remote_provider") return false;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return gridThumbnailImageExtensions.has(extension);
}
