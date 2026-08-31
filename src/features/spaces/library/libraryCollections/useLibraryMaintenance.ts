import { spacesApi } from "@/api/spaces/api";
import type { LibrarySharedReference } from "@/api/spaces/dto/interfaces/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";
import type { SelectCollection } from "./useLibraryCollectionRoute";

export type UpdateMemoryPatch = {
  title?: string;
  cover_item_id?: string;
  music_item_id?: string;
  playback_seconds?: number;
};

/** Duplicate merging, revoking outgoing shares, and Memory preferences. */
export function useLibraryMaintenance(options: {
  data: SpaceLibraryData;
  selectCollection: SelectCollection;
  reload: () => Promise<unknown>;
}) {
  const { data, selectCollection, reload } = options;
  const { spaceId, canEditLibrary, collection, visibleItems, setLocalError } = data;
  const { bulkSaving, setBulkSaving, setOutgoingReferences } = data;
  const { currentDiscoveryGroup, setDiscovery } = data;

  const mergeCurrentDuplicates = async () => {
    if (
      !canEditLibrary ||
      collection !== "duplicate" ||
      visibleItems.length < 2 ||
      bulkSaving ||
      !(await confirmAction(
        `Merge ${visibleItems.length} matching items? Misty will keep one item, combine metadata and references, and move the redundant copies to Recently Deleted.`,
      ))
    )
      return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.mergeDuplicates(spaceId, visibleItems[0], visibleItems.slice(1));
      selectCollection("duplicate");
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Duplicates could not be merged.");
    } finally {
      setBulkSaving(false);
    }
  };

  const revokeSharedReference = async (reference: LibrarySharedReference) => {
    if (!canEditLibrary) return;
    if (
      !(await confirmAction(
        `Stop sharing “${reference.display_name}” with ${reference.destination_space_name}?`,
      ))
    )
      return;
    try {
      await spacesApi.revokeLibraryGrant(spaceId, reference);
      setOutgoingReferences((current) =>
        current.filter((item) => item.grant_id !== reference.grant_id),
      );
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Sharing could not be revoked.");
    }
  };

  const updateCurrentMemory = async (patch: UpdateMemoryPatch) => {
    if (!canEditLibrary || !currentDiscoveryGroup || currentDiscoveryGroup.kind !== "memory")
      return null;
    try {
      const saved = await spacesApi.updateMemoryPreference(spaceId, currentDiscoveryGroup, patch);
      setDiscovery((current) => ({
        ...current,
        memories: current.memories.map((memory) => (memory.id === saved.id ? saved : memory)),
      }));
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Memory could not be updated.");
      return null;
    }
  };

  return { mergeCurrentDuplicates, revokeSharedReference, updateCurrentMemory };
}
