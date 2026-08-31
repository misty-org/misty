import { spacesApi } from "@/api/spaces/api";
import type { LibraryAssetStack } from "@/api/spaces/dto/interfaces/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import { buildLibraryAssetStack } from "../SpaceLibraryPrimitives";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";

const stackKindLabel = (kind: LibraryAssetStack["kind"]) =>
  kind === "live_photo" ? "Live Photo" : kind === "raw_pair" ? "RAW pair" : "burst";

const groupingHint = (kind: LibraryAssetStack["kind"]) =>
  kind === "live_photo"
    ? "Select one image and one video to make a Live Photo."
    : kind === "raw_pair"
      ? "Select one RAW file and one rendered image to make a RAW pair."
      : "Select at least two images to make a burst.";

/** Grouping and ungrouping Live Photos, RAW pairs and bursts. */
export function useLibraryAssetStacks(data: SpaceLibraryData, reload: () => Promise<void>) {
  const { spaceId, canEditLibrary, selectedItems, setSelectedItemIds } = data;
  const { setAssetStacks, setSelectedItemId, setBulkSaving, setLocalError } = data;
  const { sensitiveCollectionToken } = data;

  const createSelectedAssetStack = async (kind: LibraryAssetStack["kind"]) => {
    if (!canEditLibrary) return;
    const input = buildLibraryAssetStack(kind, selectedItems);
    if (!input) {
      setLocalError(groupingHint(kind));
      return;
    }
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.createLibraryAssetStack(spaceId, input, sensitiveCollectionToken);
      setSelectedItemIds([]);
      await reload();
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "The selected files could not be grouped.",
      );
    } finally {
      setBulkSaving(false);
    }
  };

  const patchStack = async (
    stack: LibraryAssetStack,
    patch: Parameters<typeof spacesApi.updateLibraryAssetStack>[2],
    fallback: string,
  ) => {
    try {
      const saved = await spacesApi.updateLibraryAssetStack(
        spaceId,
        stack,
        patch,
        sensitiveCollectionToken,
      );
      setAssetStacks((current) =>
        current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
      );
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : fallback);
      return null;
    }
  };

  const setAssetStackCover = async (stack: LibraryAssetStack, coverItemID: string) => {
    const saved = await patchStack(
      stack,
      { cover_item_id: coverItemID },
      "The key photo could not be changed.",
    );
    if (!saved) return;
    setSelectedItemId(saved.cover_item_id);
    await reload();
  };

  const setAssetStackEffect = async (
    stack: LibraryAssetStack,
    effect: LibraryAssetStack["effect"],
  ) => {
    await patchStack(stack, { effect }, "The Live Photo effect could not be changed.");
  };

  const ungroupAssetStack = async (stack: LibraryAssetStack) => {
    if (!(await confirmAction(`Separate this ${stackKindLabel(stack.kind)}?`))) return;
    try {
      await spacesApi.deleteLibraryAssetStack(spaceId, stack, sensitiveCollectionToken);
      setAssetStacks((current) => current.filter((candidate) => candidate.id !== stack.id));
      await reload();
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "The grouped media could not be separated.",
      );
    }
  };

  return { createSelectedAssetStack, setAssetStackCover, setAssetStackEffect, ungroupAssetStack };
}
