import { invoke } from "@tauri-apps/api/core";
import { withNativeDocumentService } from "./nativeDocumentService";
import { useAppsStore } from "./useAppsStore";

/** Trusted host adapter; captures the originating Space before asynchronous work. */
export function invokeFilesImage<T>(
  command: "explorer_preview_item" | "explorer_generate_image_thumbnail",
  args: Record<string, unknown>,
  spaceId = useAppsStore.getState().spaceId,
): Promise<T> {
  return withNativeDocumentService("files", spaceId,
    instance => invoke<T>(command, {...args, instance}), undefined, "previews");
}
