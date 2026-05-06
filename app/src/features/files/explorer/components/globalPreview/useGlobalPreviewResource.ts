import {
  archiveList,
  connectedDevicesMediaUrl,
  explorerPrepareOpenItem,
  explorerPreviewItem,
} from "@/features/files/native";
import { errorText } from "@/shared/lib/format";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import { useCallback, useEffect, useState } from "react";
import type {
  GlobalPreviewSource,
  PreviewResource,
} from "../../model/interfaces/components/GlobalPreview";
import type { GlobalPreviewKind } from "../../model/types/components/GlobalPreview";
import {
  documentXmlFile,
  naturalPathSort,
  rtfToText,
  sourceExtension,
  xmlToText,
} from "./previewFormat";
import {
  archiveExtensions,
  audioMimeTypes,
  imageMimeTypes,
  officeExtensions,
  textExtensions,
  videoMimeTypes,
} from "./previewMediaTables";

export function useGlobalPreviewResource(source: GlobalPreviewSource) {
  const [resource, setResource] = useState<PreviewResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(async () => {
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setLoading(true);
    setLoadError(null);
    setResource(null);
    void loadGlobalPreview(source)
      .then((loaded) => {
        if (!active) return;
        objectUrl = loaded.url?.startsWith("blob:") ? loaded.url : undefined;
        setResource(loaded);
      })
      .catch((reason) => {
        if (active) setLoadError(errorText(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [revision, source]);
  return { resource, loading, loadError, reload };
}

async function loadGlobalPreview(source: GlobalPreviewSource): Promise<PreviewResource> {
  const extension = sourceExtension(source);
  const mimeType =
    source.mimeType ||
    imageMimeTypes[extension] ||
    videoMimeTypes[extension] ||
    audioMimeTypes[extension] ||
    "application/octet-stream";
  const kind = globalPreviewKindForSource(extension, mimeType);
  if (source.peer && (kind === "video" || kind === "audio" || kind === "pdf")) {
    return { kind, url: await connectedDevicesMediaUrl(source.path), mimeType };
  }
  const preparedPath = source.remote
    ? (
        await explorerPrepareOpenItem({
          path: source.path,
          sizeBytes: source.sizeBytes ?? null,
          remoteModified: null,
        })
      ).localPath
    : source.path;
  if (kind === "video") return { kind, url: safeTauriAssetUrl(preparedPath), mimeType };
  if (kind === "audio") return { kind, url: safeTauriAssetUrl(preparedPath), mimeType };
  if (kind === "archive") {
    const archive = await archiveList({ path: preparedPath });
    return {
      kind: "archive",
      mimeType: "application/vnd.misty.archive-list",
      archiveEntries: archive.entries.slice(0, 500),
      archiveFormat: archive.format,
    };
  }
  if (kind === "image") return { kind, url: safeTauriAssetUrl(preparedPath), mimeType };
  const payload = await explorerPreviewItem(preparedPath);
  const bytes = new Uint8Array(payload.bytes);
  if (kind === "pdf" || payload.mimeType === "application/pdf")
    return {
      kind: "pdf",
      url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
      mimeType: "application/pdf",
    };
  if (
    kind === "markdown" ||
    kind === "text" ||
    payload.mimeType.startsWith("text/") ||
    payload.mimeType.includes("json")
  ) {
    const text = new TextDecoder().decode(bytes);
    return { kind: kind === "markdown" ? "markdown" : "text", text, mimeType: payload.mimeType };
  }
  if (kind === "document")
    return { kind, text: await extractDocumentText(extension, bytes), mimeType: payload.mimeType };
  return { kind: "generic", mimeType: payload.mimeType };
}

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
