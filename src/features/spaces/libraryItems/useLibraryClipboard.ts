import { useEffect } from "react";
import {
  copyBlobFilesToClipboard,
  copyLibraryItemsToClipboard,
} from "@/features/spaces/libraryClipboard";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  LibrarySharedReference,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";
import type { SpaceLibraryData } from "@/models/types/features/spaces/useSpaceLibraryData";
import { libraryItemMIME } from "../SpaceLibraryPrimitives";

/** Copying, duplicating and pasting edits across the current selection. */
export function useLibraryClipboard(data: SpaceLibraryData, reload: () => Promise<void>) {
  const { spaceId, canEditLibrary, canCopyLibrary, selectedItems, selectedItemId } = data;
  const { setSelectedItemIds, bulkSaving, setBulkSaving, setLocalError } = data;
  const { copiedEditDefinition, sensitiveCollectionToken } = data;

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBulkSaving(true);
    setLocalError("");
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : fallback);
    } finally {
      setBulkSaving(false);
    }
  };

  const copyItemsToClipboard = async (itemsToCopy: SpaceLibraryItem[]) => {
    if (!canCopyLibrary || itemsToCopy.length === 0 || bulkSaving) return;
    await run(async () => {
      await copyLibraryItemsToClipboard(spaceId, itemsToCopy, sensitiveCollectionToken);
      setSelectedItemIds([]);
    }, "The selected Library items could not be copied.");
  };

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

  // Cmd/Ctrl-C copies the grid selection, but only while the viewer is closed —
  // an open item binds its own copy shortcut.
  useEffect(() => {
    if (!canCopyLibrary || selectedItems.length === 0 || selectedItemId) return;
    const copySelection = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "c") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      void copyItemsToClipboard(selectedItems);
    };
    window.addEventListener("keydown", copySelection);
    return () => window.removeEventListener("keydown", copySelection);
  }, [canCopyLibrary, selectedItemId, selectedItems]);

  return { copyItemsToClipboard, copySharedReferenceToClipboard, duplicateItems, pasteEdits };
}
