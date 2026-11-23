import { formatDriveBytes } from "../drive";
import { itemShape, type FileItem } from "./model";

export const formatBytes = (bytes: number) => formatDriveBytes(bytes);

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

const PICTURED = new Set(
  "png apng jpg jpeg gif webp avif svg bmp ico heic heif tif tiff".split(" "),
);

export const isPictured = (name: string) => PICTURED.has(extensionOf(name));

const ARCHIVES = new Set("zip tar gz tgz bz2 xz 7z rar".split(" "));

export const isArchive = (name: string) => ARCHIVES.has(extensionOf(name));

export function messageOf(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  return message.trim() || fallback;
}

export const countText = (count: number, one = "item", many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
