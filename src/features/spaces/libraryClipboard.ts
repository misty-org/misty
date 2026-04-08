import { clipboardWriteFileBytes } from "@/stores/backend";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";

export async function copyLibraryItemsToClipboard(
  spaceId: string,
  items: SpaceLibraryItem[],
  reauthenticationToken = "",
): Promise<void> {
  if (items.length === 0) return;
  const files: Array<{ name: string; blob: Blob }> = [];
  for (const item of items) {
    const blob = await spacesApi.libraryContent(spaceId, item.id, reauthenticationToken);
    files.push({ name: clipboardFileName(item), blob });
  }
  await copyBlobFilesToClipboard(files);
}

export async function copyBlobFilesToClipboard(
  files: Array<{ name: string; blob: Blob }>,
): Promise<void> {
  if (files.length === 0) return;
  const copied = await clipboardWriteFileBytes(
    await Promise.all(
      files.map(async ({ name, blob }) => ({
        name,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
      })),
    ),
  );
  if (!copied) throw new Error("The selected Library items could not be placed on the clipboard.");
}

function clipboardFileName(item: SpaceLibraryItem): string {
  const originalName = item.file.original_filename || "Library item";
  const displayName = item.display_name.trim() || originalName;
  if (/\.[^./\\]+$/.test(displayName)) return displayName;
  const extension = originalName.match(/\.[^./\\]+$/)?.[0] ?? "";
  return `${displayName}${extension}`;
}
