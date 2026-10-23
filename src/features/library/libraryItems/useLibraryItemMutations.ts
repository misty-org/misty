import { spacesApi } from "@/api/spaces/api";
import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import { confirmAction } from "@/shared/lib/confirmAction";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

export type LibraryItemPatch = Partial<
  Pick<SpaceLibraryItem, "display_name" | "caption" | "hidden" | "tags">
>;

/** Single-item edits, trashing and restoring, plus grid selection helpers. */
export function useLibraryItemMutations(data: SpaceLibraryData) {
  const { spaceId, canEditLibrary } = data;
  const { setItems, setVisibleItems, setSelectedItemId, setSelectedItemIds } = data;
  const { setSearchInput, setLocalError } = data;

  const removeFromLists = (itemId: string) => {
    setItems((current) => current.filter((candidate) => candidate.id !== itemId));
    setVisibleItems((current) => current.filter((candidate) => candidate.id !== itemId));
  };

  const replaceItem = (saved: SpaceLibraryItem) => {
    setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    setVisibleItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  };

  /** Saves a patch and puts the saved item in place of the old one. */
  const updateItem = async (item: SpaceLibraryItem, patch: LibraryItemPatch) => {
    if (!canEditLibrary) return null;
    try {
      const saved = await spacesApi.updateLibraryItem(spaceId, item, patch);
      replaceItem(saved);
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Library item could not be updated.");
      return null;
    }
  };

  const trashItem = async (item: SpaceLibraryItem) => {
    if (!canEditLibrary) return false;
    if (!(await confirmAction(`Move “${item.display_name}” to Recently Deleted?`))) return false;
    try {
      await spacesApi.trashLibraryItem(spaceId, item.id);
      removeFromLists(item.id);
      setSelectedItemId("");
      return true;
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "Library item could not be moved to Recently Deleted.",
      );
      return false;
    }
  };

  const restoreItem = async (item: SpaceLibraryItem) => {
    if (!canEditLibrary) return;
    try {
      await spacesApi.restoreLibraryItem(spaceId, item.id);
      removeFromLists(item.id);
      setSelectedItemId("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Library item could not be restored.");
    }
  };

  const toggleSelectedItem = (itemId: string) =>
    setSelectedItemIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    );

  /** Appends `key:value` to the search box, quoting values that contain spaces. */
  const appendSearchFacet = (key: "tag" | "type" | "year", value: string) => {
    const escapedValue = /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
    setSearchInput((current) => `${current.trim()} ${key}:${escapedValue}`.trim());
  };

  return { updateItem, replaceItem, trashItem, restoreItem, toggleSelectedItem, appendSearchFacet };
}
