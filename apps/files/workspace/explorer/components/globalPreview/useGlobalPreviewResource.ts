import {
  archiveList,
  connectedDevicesMediaUrl,
  explorerPrepareOpenItem,
  explorerPreviewItem,
} from "@/features/files/native";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import type {
  GlobalPreviewSource,
  PreviewResource,
} from "../../model/interfaces/components/GlobalPreview";
import { sourceExtension } from "./previewFormat";
import { audioMimeTypes, imageMimeTypes, videoMimeTypes } from "./previewMediaTables";
import { extractDocumentText, globalPreviewKindForSource } from "./previewDocument";
export { extractDocumentText, globalPreviewKindForSource } from "./previewDocument";
import { usePreviewResource } from "./usePreviewResource";
export function useGlobalPreviewResource(source: GlobalPreviewSource) {
  return usePreviewResource(source, loadGlobalPreview);
}

export async function loadGlobalPreview(source: GlobalPreviewSource): Promise<PreviewResource> {
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
