import { spacesApi } from "@/api/spaces/api";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/workspace";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { useCallback } from "react";
import { copyLibraryItemsToClipboard } from "../libraryClipboard";
import { libraryItemMIME } from "../SpaceLibraryPrimitives";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

/** Copying, duplicating and pasting edits across the current selection. */
export function useLibraryClipboard(data: SpaceLibraryData, reload: () => Promise<void>) {
  const workspaceFocused = useWorkspaceViewFocused();
  const { spaceId, canEditLibrary, selectedItems, selectedItemId } = data;
  const { setSelectedItemIds, bulkSaving, setBulkSaving, setLocalError } = data;
  const { copiedEditDefinition } = data;

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
      if (itemsToCopy.length === 0 || bulkSaving) return;
      await run(async () => {
        await copyLibraryItemsToClipboard(spaceId, itemsToCopy);
        setSelectedItemIds([]);
      }, "The selected Library items could not be copied.");
    },
    [bulkSaving, run, setSelectedItemIds, spaceId],
  );

  const duplicateItems = async (itemIDs: string[]) => {
    if (!canEditLibrary || itemIDs.length === 0 || bulkSaving) return;
    await run(async () => {
      await spacesApi.duplicateLibraryItems(spaceId, itemIDs);
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
        const result = await spacesApi.createEditVersion(spaceId, item, copiedEditDefinition);
        if (result.edit) await spacesApi.renderEditVersion(spaceId, item.id, result.edit.id, 0);
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
    workspaceFocused && selectedItems.length > 0 && !selectedItemId,
  );

  return { copyItemsToClipboard, duplicateItems, pasteEdits };
}
