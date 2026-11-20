import type { AvatarTone, DriveSyncState, InUsePerson } from "@misty/ui";
import type { DriveEntry } from "./driveNative";

const IMAGE = "bmp gif heic heif jpeg jpg png tif tiff webp avif apng svg ico".split(" ");
const VIDEO = "avi m4v mkv mov mp4 mpeg mpg webm".split(" ");
const AUDIO = "aac aif aiff flac m4a mp3 ogg opus wav".split(" ");
const OTHER: Record<string, string> = {
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  xml: "application/xml",
  zip: "application/zip",
};

/** A file's MIME type from its name, `application/octet-stream` when the extension says nothing. */
export function mimeFromName(name: string): string {
  const extension = name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "ico") return "image/x-icon";
  if (IMAGE.includes(extension))
    return `image/${extension === "jpg" ? "jpeg" : extension === "tif" ? "tiff" : extension}`;
  if (VIDEO.includes(extension))
    return `video/${extension === "mov" ? "quicktime" : extension === "m4v" ? "mp4" : extension}`;
  if (AUDIO.includes(extension)) return `audio/${extension === "mp3" ? "mpeg" : extension}`;
  return OTHER[extension] ?? "application/octet-stream";
}

/** A size people read: "4.2 MB". */
export function formatDriveBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${value} B`;
}

/** The StateMark a drive file wears: none while it is downloaded and in step. */
export function driveSyncMark(entry: Pick<DriveEntry, "state">): DriveSyncState | undefined {
  switch (entry.state) {
    case "online":
      return "online-only";
    case "downloading":
      return "downloading";
    case "uploading":
      return "uploading";
    case "not_synced":
      return "not-synced";
    default:
      return undefined;
  }
}

/**
 * Who has the file open, for an InUseMark: other people first, then the person's own computers,
 * which read as "You". `toneOf` gives each person the tone their avatar wears elsewhere.
 */
export function driveInUsePeople(
  entry: Pick<DriveEntry, "in_use">,
  toneOf?: (userId: string) => AvatarTone,
): InUsePerson[] {
  return entry.in_use.map((person) => ({
    name: person.name,
    tone: person.user_id && toneOf ? toneOf(person.user_id) : undefined,
    editing: person.editing,
    device: person.device_name || undefined,
    you: person.you || undefined,
  }));
}
