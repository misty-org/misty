import type { GlobalPreviewSource } from "./preview_types";
import {
  archiveExtensions,
  audioMimeTypes,
  imageMimeTypes,
  officeExtensions,
  textExtensions,
  videoMimeTypes,
} from "./preview_media_tables";

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

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bull: "\u2022",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
};

function codePoint(value: number, fallback: string): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback;
  if (value >= 0xd800 && value <= 0xdfff) return fallback;
  return String.fromCodePoint(value);
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#")
      return codePoint(
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10),
        whole,
      );
    return namedEntities[body.toLowerCase()] ?? whole;
  });
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
export function sourceExtension(source: GlobalPreviewSource): string {
  return (source.extension || source.name.split(".").pop() || "").replace(/^\./, "").toLowerCase();
}
export function friendlyType(extension: string, mimeType?: string | null): string {
  return extension
    ? `${extension.toUpperCase()} ${typeFamily(extension, mimeType)}`
    : mimeType || "File";
}
function typeFamily(extension: string, mimeType?: string | null): string {
  if (imageMimeTypes[extension] || mimeType?.startsWith("image/")) return "image";
  if (videoMimeTypes[extension] || mimeType?.startsWith("video/")) return "video";
  if (audioMimeTypes[extension] || mimeType?.startsWith("audio/")) return "audio";
  if (extension === "pdf" || officeExtensions.has(extension)) return "document";
  if (textExtensions.has(extension)) return "text";
  if (archiveExtensions.has(extension)) return "archive";
  return "file";
}

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "document" | "other";

export function previewKind(name: string, mimeType: string): PreviewKind {
  const extension = sourceExtension({ path: "", name });
  if (mimeType.startsWith("image/") || imageMimeTypes[extension]) return "image";
  if (mimeType.startsWith("video/") || videoMimeTypes[extension]) return "video";
  if (mimeType.startsWith("audio/") || audioMimeTypes[extension]) return "audio";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (textExtensions.has(extension)) return "text";
  if (officeExtensions.has(extension)) return "document";
  return "other";
}
