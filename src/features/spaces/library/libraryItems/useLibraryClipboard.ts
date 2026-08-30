import { spacesApi } from "@/api/spaces/api";
import { useShortcutHandler } from "@/features/shortcuts";
import type { LibrarySharedReference, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { useCallback } from "react";
import { copyBlobFilesToClipboard, copyLibraryItemsToClipboard } from "../libraryClipboard";
import { libraryItemMIME } from "../SpaceLibraryPrimitives";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

/** Copying, duplicating and pasting edits across the current selection. */
export function useLibraryClipboard(data: SpaceLibraryData, reload: () => Promise<void>) {
  const { spaceId, canEditLibrary, canCopyLibrary, selectedItems, selectedItemId } = data;
  const { setSelectedItemIds, bulkSaving, setBulkSaving, setLocalError } = data;
  const { copiedEditDefinition, sensitiveCollectionToken } = data;

  const run = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      setBulkSaving(true);
      setLocalError("");
      try {
        await action();
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : fallback);
      } finally {
        setBulkSaving(false);
      }
    },
    [setBulkSaving, setLocalError],
  );

  const copyItemsToClipboard = useCallback(
    async (itemsToCopy: SpaceLibraryItem[]) => {
      if (!canCopyLibrary || itemsToCopy.length === 0 || bulkSaving) return;
      await run(async () => {
        await copyLibraryItemsToClipboard(spaceId, itemsToCopy, sensitiveCollectionToken);
        setSelectedItemIds([]);
      }, "The selected Library items could not be copied.");
    },
    [bulkSaving, canCopyLibrary, run, sensitiveCollectionToken, setSelectedItemIds, spaceId],
  );

  const copySharedReferenceToClipboard = async (reference: LibrarySharedReference) => {
    if (!canCopyLibrary || bulkSaving) return;
    await run(async () => {
      const blob = await spacesApi.sharedReferenceContent(spaceId, reference.id);
      await copyBlobFilesToClipboard([{ name: reference.display_name, blob }]);
    }, "The shared Library item could not be copied.");
  };

  const duplicateItems = async (itemIDs: string[]) => {
    if (!canEditLibrary || !canCopyLibrary || itemIDs.length === 0 || bulkSaving) return;
    await run(async () => {
      await spacesApi.duplicateLibraryItems(spaceId, itemIDs, sensitiveCollectionToken);
      setSelectedItemIds([]);
      await reload();
    }, "The selected Library items could not be duplicated.");
  };

  const pasteEdits = async () => {
    if (!canEditLibrary || !copiedEditDefinition || selectedItems.length === 0 || bulkSaving)
      return;
    const editableItems = selectedItems.filter((item) =>
      /^(image|video)\//.test(libraryItemMIME(item)),
    );
    if (editableItems.length === 0) {
      setLocalError("Select images or videos to paste these edits.");
      return;
    }
    await run(async () => {
      for (const item of editableItems) {
        const result = await spacesApi.createEditVersion(
          spaceId,
          item,
          copiedEditDefinition,
          sensitiveCollectionToken,
        );
        if (result.edit)
          await spacesApi.renderEditVersion(
            spaceId,
            item.id,
            result.edit.id,
            0,
            sensitiveCollectionToken,
          );
      }
      setSelectedItemIds([]);
      await reload();
    }, "The edits could not be pasted.");
  };

  useShortcutHandler(
    "library.copy",
    useCallback(
      () => void copyItemsToClipboard(selectedItems),
      [copyItemsToClipboard, selectedItems],
    ),
    canCopyLibrary && selectedItems.length > 0 && !selectedItemId,
  );

  return { copyItemsToClipboard, copySharedReferenceToClipboard, duplicateItems, pasteEdits };
}
