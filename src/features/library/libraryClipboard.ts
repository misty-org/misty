import { spacesApi } from "@/api/spaces/api";
import { clipboardWriteFileBytes } from "@/native";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";

export async function copyLibraryItemsToClipboard(
  spaceId: string,
  items: SpaceLibraryItem[],
): Promise<void> {
  if (items.length === 0) return;
  const files: Array<{ name: string; blob: Blob }> = [];
  for (const item of items) {
    const blob = await spacesApi.libraryContent(spaceId, item.id);
    files.push({ name: clipboardFileName(item), blob });
  }
  await copyBlobFilesToClipboard(files);
}

async function copyBlobFilesToClipboard(files: Array<{ name: string; blob: Blob }>): Promise<void> {
  if (files.length === 0) return;
  const copied = await clipboardWriteFileBytes(
    await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
      })),
    ),
  );
  if (!copied) throw new Error("The files could not be copied.");
}

function clipboardFileName(item: SpaceLibraryItem): string {
  const originalName = item.file.original_filename || "Library item";
  const displayName = item.display_name.trim() || originalName;
  if (/\.[^./\\]+$/.test(displayName)) return displayName;
  const extension = originalName.match(/\.[^./\\]+$/)?.[0] ?? "";
  return `${displayName}${extension}`;
}
