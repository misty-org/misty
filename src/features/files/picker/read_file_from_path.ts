import { disk } from "../api/disk";
import { readLocalFileFromPath } from "../api/local_files";

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "file";
}

const bufferOf = (bytes: ArrayBuffer | number[]) =>
  bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;

export async function readFileFromPath(path: string): Promise<File> {
  const name = fileNameFromPath(path);
  try {
    const bytes = bufferOf(await disk.readBytes(path));
    return new File([bytes], name, { type: mimeOf(name), lastModified: Date.now() });
  } catch (cause) {
    return readLocalFileFromPath(path, name).catch(() => {
      throw cause;
    });
  }
}

const MIME: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  heic: "image/heic",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
};

function mimeOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 && MIME[name.slice(dot + 1).toLowerCase()]) || "application/octet-stream";
}
