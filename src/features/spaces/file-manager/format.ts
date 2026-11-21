import { formatDriveBytes } from "../drive";
import { itemShape, type FileItem } from "./model";

/** A size people read: "4.2 MB". */
export const formatBytes = (bytes: number) => formatDriveBytes(bytes);

/** A date as Finder's list writes it: "Nov 20, 2026 at 3:04 PM". */
export function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
};

export { extensionOf };

const kinds: Record<string, string> = {
  pdf: "PDF document",
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  gif: "GIF image",
  webp: "WebP image",
  heic: "HEIC image",
  svg: "SVG image",
  mp4: "MPEG-4 movie",
  mov: "QuickTime movie",
  mp3: "MP3 audio",
  wav: "WAV audio",
  m4a: "Apple MPEG-4 audio",
  zip: "ZIP archive",
  txt: "Plain text",
  md: "Markdown document",
  csv: "CSV document",
  json: "JSON document",
  html: "HTML document",
  dmg: "Disk image",
  app: "Application",
  exe: "Application",
};

/** What the item is in words, for the Kind column. */
export function kindOf(item: FileItem): string {
  const source = item.source;
  if (source.kind === "disk") {
    if (source.entry.kind === "link") return "Alias";
    if (source.entry.kind === "package")
      return extensionOf(item.name) === "app" ? "Application" : "Package";
  }
  if (itemShape(item) === "folder") return "Folder";
  const extension = extensionOf(item.name);
  return kinds[extension] ?? (extension ? `${extension.toUpperCase()} file` : "Document");
}

/** The images the grid draws from the file itself. */
const PICTURED = new Set("png apng jpg jpeg gif webp avif svg bmp ico heic heif tif tiff".split(" "));

export const isPictured = (name: string) => PICTURED.has(extensionOf(name));

/** The archives Files can open (zip, tar and its compressions, 7z and rar through their tools). */
const ARCHIVES = new Set("zip tar gz tgz bz2 xz 7z rar".split(" "));

export const isArchive = (name: string) => ARCHIVES.has(extensionOf(name));

/** What a failed call said, or a plain fallback. */
export function messageOf(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return message.trim() || fallback;
}

/** "3 items", "1 item". */
export const countText = (count: number, one = "item", many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
