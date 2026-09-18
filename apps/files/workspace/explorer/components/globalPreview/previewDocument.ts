import type { GlobalPreviewKind } from "../../model/types/components/GlobalPreview";
import { documentXmlFile, naturalPathSort, rtfToText, xmlToText } from "./previewFormat";
import {
  archiveExtensions,
  audioMimeTypes,
  imageMimeTypes,
  officeExtensions,
  textExtensions,
  videoMimeTypes,
} from "./previewMediaTables";
export function globalPreviewKindForSource(extension: string, mimeType = ""): GlobalPreviewKind {
  const normalizedExtension = extension.replace(/^\./, "").toLocaleLowerCase();
  const normalizedMimeType = mimeType.split(";")[0].trim().toLocaleLowerCase();
  if (videoMimeTypes[normalizedExtension] || normalizedMimeType.startsWith("video/"))
    return "video";
  if (audioMimeTypes[normalizedExtension] || normalizedMimeType.startsWith("audio/"))
    return "audio";
  if (archiveExtensions.has(normalizedExtension)) return "archive";
  if (imageMimeTypes[normalizedExtension] || normalizedMimeType.startsWith("image/"))
    return "image";
  if (normalizedExtension === "pdf" || normalizedMimeType === "application/pdf") return "pdf";
  if (normalizedExtension === "md" || normalizedExtension === "markdown") return "markdown";
  if (
    textExtensions.has(normalizedExtension) ||
    normalizedMimeType.startsWith("text/") ||
    normalizedMimeType.includes("json")
  )
    return "text";
  if (officeExtensions.has(normalizedExtension)) return "document";
  return "generic";
}

export async function extractDocumentText(extension: string, bytes: Uint8Array): Promise<string> {
  if (extension === "docx") {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({
      arrayBuffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    });
    return result.value.trim();
  }
  if (extension === "rtf") return rtfToText(new TextDecoder("latin1").decode(bytes));
  if (extension === "doc" || extension === "xls" || extension === "ppt")
    return "This legacy Office file can be opened in its default application. Save it as DOCX, XLSX, or PPTX for an inline text reader.";
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files)
    .filter((name) => documentXmlFile(extension, name))
    .sort(naturalPathSort);
  const chunks: string[] = [];
  for (const name of names.slice(0, 300)) {
    const xml = await zip.files[name].async("text");
    const text = xmlToText(xml);
    if (text) chunks.push(text);
  }
  return chunks.join("\n\n").trim();
}
