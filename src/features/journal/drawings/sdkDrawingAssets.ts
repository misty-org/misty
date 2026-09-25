import { MISTY_JOURNAL_ASSET_MAX_BYTES, type MistyAppSDK } from "@misty/sdk";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { DrawingAssetReference } from "./types";

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};
const identifier = /^[A-Za-z0-9_-]{1,256}$/;
function imageBlob(file: BinaryFileData): Blob {
  const type = String(file.mimeType).toLowerCase();
  if (!extensions[type] || !identifier.test(file.id)) throw new Error("Unsupported drawing image.");
  const prefix = `data:${type};base64,`;
  if (
    !file.dataURL.startsWith(prefix) ||
    file.dataURL.length > prefix.length + 4 * Math.ceil(MISTY_JOURNAL_ASSET_MAX_BYTES / 3)
  )
    throw new Error("Choose a supported image of 15 MB or smaller.");
  const encoded = file.dataURL.slice(prefix.length);
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Error("The drawing image is not valid base64 data.");
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > MISTY_JOURNAL_ASSET_MAX_BYTES)
    throw new Error("Choose a supported image of 15 MB or smaller.");
  return new Blob([bytes], { type });
}
async function imageDataURL(blob: Blob): Promise<DataURL> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 16 * 1024)
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 16 * 1024)));
  return `data:${blob.type};base64,${btoa(chunks.join(""))}` as DataURL;
}

/** Images remain in verified object storage; Yjs carries only their stable asset references. */
export function createSdkDrawingAssets(misty: MistyAppSDK, spaceId: string, signal: AbortSignal) {
  let closed = signal.aborted,
    pending = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const assert = (space: string) => {
    if (closed || signal.aborted) throw new Error("This Journal view is closed.");
    if (!spaceId || space !== spaceId) throw new Error("This drawing belongs to another Space.");
  };
  const close = () => {
    closed = true;
    signal.removeEventListener("abort", close);
  };
  signal.addEventListener("abort", close, { once: true });
  const enqueue = <T>(space: string, work: () => Promise<T>): Promise<T> => {
    assert(space);
    if (pending >= 32)
      return Promise.reject(
        new Error("Too many drawing images are loading. Try again when they finish."),
      );
    pending++;
    const result = queue
      .then(async () => {
        assert(space);
        const value = await work();
        assert(space);
        return value;
      })
      .finally(() => {
        pending--;
      });
    queue = result.catch(() => undefined);
    return result;
  };
  return {
    close,
    upload(space: string, drawingId: string, file: BinaryFileData): Promise<DrawingAssetReference> {
      return enqueue(space, async () => {
        const blob = imageBlob(file);
        const asset = await misty.journal.assets.upload({
          resource: "drawing",
          resourceId: drawingId,
          externalFileId: file.id,
          filename: `${file.id}.${extensions[blob.type]}`,
          file: blob,
        });
        return { assetId: asset.id, fileId: file.id, mimeType: blob.type, created: file.created };
      });
    },
    hydrate(
      space: string,
      drawingId: string,
      reference: DrawingAssetReference,
    ): Promise<BinaryFileData> {
      return enqueue(space, async () => {
        if (
          !identifier.test(reference.assetId) ||
          !identifier.test(reference.fileId) ||
          !extensions[reference.mimeType] ||
          !Number.isFinite(reference.created)
        )
          throw new Error("Invalid shared drawing image reference.");
        const { file } = await misty.journal.assets.download({
          resource: "drawing",
          resourceId: drawingId,
          assetId: reference.assetId,
        });
        assert(space);
        if (
          file.type !== reference.mimeType ||
          file.size < 1 ||
          file.size > MISTY_JOURNAL_ASSET_MAX_BYTES
        )
          throw new Error("The shared image no longer matches this drawing.");
        return {
          id: reference.fileId as FileId,
          mimeType: file.type as BinaryFileData["mimeType"],
          dataURL: await imageDataURL(file),
          created: reference.created,
          lastRetrieved: Date.now(),
        };
      });
    },
  };
}
