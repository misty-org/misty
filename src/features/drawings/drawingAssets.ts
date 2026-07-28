import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import {
  journalAssetDownloadPath,
  resolveJournalAssetUrl,
  uploadJournalAsset,
} from "@/features/journal/assets/journalAssetTransfer";
import type { DrawingAssetReference } from "./types";

const drawingAssetExtensions: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

export async function uploadDrawingBinaryFile(
  spaceId: string,
  drawingId: string,
  file: BinaryFileData,
): Promise<DrawingAssetReference> {
  const mimeType = String(file.mimeType).toLowerCase();
  const extension = drawingAssetExtensions[mimeType];
  if (!extension) {
    throw new Error("This image format cannot be shared safely.");
  }
  const blob = await fetch(file.dataURL).then((response) => response.blob());
  const uploaded = await uploadJournalAsset({
    kind: "drawing",
    spaceId,
    resourceId: drawingId,
    externalFileId: file.id,
    file: new File([blob], `${file.id}.${extension}`, { type: mimeType }),
  });
  return {
    assetId: uploaded.id,
    fileId: file.id,
    mimeType,
    created: file.created,
  };
}

export async function hydrateDrawingBinaryFile(
  spaceId: string,
  drawingId: string,
  reference: DrawingAssetReference,
): Promise<BinaryFileData> {
  const dataURL = await resolveJournalAssetUrl(
    journalAssetDownloadPath("drawing", spaceId, drawingId, reference.assetId),
  );
  return {
    id: reference.fileId as FileId,
    mimeType: reference.mimeType as BinaryFileData["mimeType"],
    dataURL: dataURL as DataURL,
    created: reference.created,
    lastRetrieved: Date.now(),
  };
}
