import { spacesApi } from "../../api/api";
import { useShortcutHandler } from "@/features/shortcuts";
import { useWorkspaceViewFocused } from "@/features/app-windows";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import { useCallback } from "react";
import { copyLibraryItemsToClipboard } from "../libraryClipboard";
import type { SpaceLibraryData } from "../hook-signatures/useSpaceLibraryData";

/** Copying and duplicating across the current selection. */
export function useLibraryClipboard(data: SpaceLibraryData, reload: () => Promise<void>) {
  const workspaceFocused = useWorkspaceViewFocused();
  const { spaceId, canEditLibrary, selectedItems, selectedItemId } = data;
  const { setSelectedItemIds, bulkSaving, setBulkSaving, setLocalError } = data;

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
      }, "The selected files could not be copied.");
    },
    [bulkSaving, run, setSelectedItemIds, spaceId],
  );

  const duplicateItems = async (itemIDs: string[]) => {
    if (!canEditLibrary || itemIDs.length === 0 || bulkSaving) return;
    await run(async () => {
      await spacesApi.duplicateLibraryItems(spaceId, itemIDs);
      setSelectedItemIds([]);
      await reload();
    }, "The selected files could not be duplicated.");
  };

  useShortcutHandler(
    "library.copy",
    useCallback(
      () => void copyItemsToClipboard(selectedItems),
      [copyItemsToClipboard, selectedItems],
    ),
    workspaceFocused && selectedItems.length > 0 && !selectedItemId,
  );

  return { copyItemsToClipboard, duplicateItems };
}
