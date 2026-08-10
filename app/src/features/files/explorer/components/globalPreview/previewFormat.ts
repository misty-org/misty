import type { GlobalPreviewSource } from "../../model/interfaces/components/GlobalPreview";
import {
  archiveExtensions,
  audioMimeTypes,
  imageMimeTypes,
  officeExtensions,
  textExtensions,
  videoMimeTypes,
} from "./previewMediaTables";

export function documentXmlFile(extension: string, name: string): boolean {
  if (extension === "pptx") return /^ppt\/slides\/slide\d+\.xml$/i.test(name);
  if (extension === "xlsx") return /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/i.test(name);
  if (extension === "epub") return /\.(xhtml|html|htm)$/i.test(name);
  return name === "content.xml";
}

export function xmlToText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<\/(?:w:p|a:p|text:p|text:h|tr|row|div|p|h[1-6])>/gi, "\n")
      .replace(/<\/(?:w:tab|tab|td|c)>/gi, "\t")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeXmlEntities(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

export function rtfToText(value: string): string {
  return value
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function naturalPathSort(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

export function imageOutputMimeType(extension: string): string {
  return extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "webp"
      ? "image/webp"
      : "image/png";
}
export function sourceExtension(source: GlobalPreviewSource): string {
  return (source.extension || source.name.split(".").pop() || "").replace(/^\./, "").toLowerCase();
}
export function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}
export function friendlyType(extension: string, mimeType?: string | null): string {
  return extension
    ? `${extension.toUpperCase()} ${typeFamily(extension, mimeType)}`
    : mimeType || "File";
}
export function typeFamily(extension: string, mimeType?: string | null): string {
  if (imageMimeTypes[extension] || mimeType?.startsWith("image/")) return "image";
  if (videoMimeTypes[extension] || mimeType?.startsWith("video/")) return "video";
  if (audioMimeTypes[extension] || mimeType?.startsWith("audio/")) return "audio";
  if (extension === "pdf" || officeExtensions.has(extension)) return "document";
  if (textExtensions.has(extension)) return "text";
  if (archiveExtensions.has(extension)) return "archive";
  return "file";
}
