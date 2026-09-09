import { explorerGenerateImageThumbnail } from "@/features/files/native";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import { createGridThumbnailQueue } from "./createGridThumbnailQueue";
export { gridThumbnailSupported } from "./gridThumbnailSupported";
const queue = createGridThumbnailQueue(async (entry, maxDimension) => {
  const payload = await explorerGenerateImageThumbnail(entry.path, maxDimension, {
    modifiedMs: entry.modifiedMs,
    remoteModified: entry.remoteModified,
    sizeBytes: entry.sizeBytes,
  });
  return safeTauriAssetUrl(payload.path);
});
export const { prewarmGridThumbnails, requestGridThumbnail } = queue;
