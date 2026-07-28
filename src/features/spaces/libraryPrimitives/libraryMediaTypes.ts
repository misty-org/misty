import type { SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";

const IMAGE_EXTENSIONS = [
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "tif",
  "tiff",
  "webp",
];
const VIDEO_EXTENSIONS = ["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"];
const AUDIO_EXTENSIONS = ["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav"];
const RAW_PATTERN = /\.(?:dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef|x3f)$/i;

/**
 * The item's MIME type, falling back to its file extension.
 *
 * Uploads frequently arrive as `application/octet-stream`, which tells the
 * viewer nothing, so the extension is used whenever the declared type is
 * missing or generic.
 */
export function libraryItemMIME(item: SpaceLibraryItem): string {
  const metadataMIME = String(
    item.file.intrinsic_metadata.server_detected_mime_type ??
      item.file.intrinsic_metadata.client_declared_mime_type ??
      "",
  )
    .split(";")[0]
    .toLocaleLowerCase();
  if (metadataMIME && metadataMIME !== "application/octet-stream") return metadataMIME;

  const extension = item.file.original_filename.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.includes(extension))
    return `image/${extension === "jpg" ? "jpeg" : extension === "tif" ? "tiff" : extension}`;
  if (VIDEO_EXTENSIONS.includes(extension))
    return `video/${extension === "mov" ? "quicktime" : extension === "m4v" ? "mp4" : extension}`;
  if (AUDIO_EXTENSIONS.includes(extension))
    return `audio/${extension === "mp3" ? "mpeg" : extension}`;
  return "application/octet-stream";
}

/** A short, human-facing type label such as "JPEG", "MOV" or "PDF". */
export function libraryFileTypeLabel(item: SpaceLibraryItem): string {
  const mime = libraryItemMIME(item);
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/"))
    return mime
      .slice(6)
      .replace("jpeg", "JPEG")
      .replace("png", "PNG")
      .replace("webp", "WebP")
      .toUpperCase();
  if (mime.startsWith("video/")) return mime.slice(6).replace("quicktime", "MOV").toUpperCase();
  if (mime.startsWith("audio/")) return mime.slice(6).replace("mpeg", "MP3").toUpperCase();
  const extension = item.file.original_filename.split(".").pop()?.trim();
  return extension ? extension.toUpperCase() : "File";
}

export function isLibraryRAW(filename: string): boolean {
  return RAW_PATTERN.test(filename);
}

/** Returns the grant token only while it is still valid, otherwise "". */
export function activeSensitiveGrant(grant?: { token: string; expiresAt: string }): string {
  return grant && new Date(grant.expiresAt).getTime() > Date.now() ? grant.token : "";
}
