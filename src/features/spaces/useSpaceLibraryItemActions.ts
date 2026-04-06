import { useEffect, type FormEvent } from "react";

import { confirmAction } from "@/shared/confirmAction";
import { spacesApi } from "@/spaces/api";
import { copyBlobFilesToClipboard, copyLibraryItemsToClipboard } from "@/spaces/libraryClipboard";
import type {
  BulkLibraryItemAction,
  BulkLibraryItemOptions,
  LibraryAssetStack,
  LibrarySharedReference,
  SpaceLibraryItem,
} from "@/spaces/types";

import {
  buildLibraryAssetStack,
  detectUploadedAssetStacks,
  libraryItemMIME,
} from "./SpaceLibraryPrimitives";
import type { LibraryUploadJob, SpaceLibraryData } from "./useSpaceLibraryData";

export function useSpaceLibraryItemActions(data: SpaceLibraryData) {
  const {
    spaceId,
    canUploadLibrary,
    canEditLibrary,
    canCopyLibrary,
    collection,
    items,
    setItems,
    visibleItems,
    setVisibleItems,
    setUsage,
    setAssetStacks,
    setAlbums,
    setAlbumFolders,
    setGroups,
    setPeoplePolicy,
    setPeople,
    setDiscovery,
    setSharedReferences,
    setOutgoingReferences,
    setPins,
    setImportHistory,
    nextAfter,
    setNextAfter,
    loadingMore,
    setLoadingMore,
    libraryQuery,
    uploadJobs,
    setUploadJobs,
    selectedItems,
    selectedItemId,
    setSelectedItemId,
    setSelectedItemIds,
    bulkSaving,
    setBulkSaving,
    copiedEditDefinition,
    sensitiveCollectionToken,
    setLocalError,
    setReloadKey,
    metadataDialogAction,
    setMetadataDialogAction,
    metadataTags,
    setMetadataTags,
    metadataDate,
    setMetadataDate,
    metadataLocationName,
    setMetadataLocationName,
    metadataLatitude,
    setMetadataLatitude,
    metadataLongitude,
    setMetadataLongitude,
    setSearchInput,
    unlockScope,
    setUnlockScope,
    unlockPassword,
    setUnlockPassword,
    unlockSaving,
    setUnlockSaving,
    setSensitiveGrants,
  } = data;

  const reload = async () => {
    const [
      currentUsage,
      albumResult,
      folderResult,
      groupResult,
      policyResult,
      peopleResult,
      discoveryResult,
      sharedResult,
      pinResult,
      importResult,
      stackResult,
    ] = await Promise.all([
      spacesApi.libraryUsage(spaceId),
      spacesApi.albums(spaceId),
      spacesApi.albumFolders(spaceId).catch(() => ({ folders: [] })),
      spacesApi.groups(spaceId).catch(() => ({ groups: [] })),
      spacesApi.peoplePolicy(spaceId).catch(() => null),
      spacesApi.people(spaceId).catch(() => ({ people: [] })),
      spacesApi.libraryDiscovery(spaceId).catch(() => ({
        recent_days: [],
        months: [],
        years: [],
        memories: [],
        trips: [],
        duplicates: [],
        map_points: [],
      })),
      spacesApi.sharedReferences(spaceId).catch(() => ({ references: [], outgoing: [] })),
      spacesApi.libraryPins(spaceId).catch(() => ({ pins: [] })),
      spacesApi.libraryImportHistory(spaceId).catch(() => ({ imports: [] })),
      spacesApi.libraryAssetStacks(spaceId).catch(() => ({ stacks: [] })),
    ]);
    setUsage(currentUsage);
    setAlbums(albumResult.albums);
    setAlbumFolders(folderResult.folders);
    setGroups(groupResult.groups);
    setPeoplePolicy(policyResult);
    setPeople(peopleResult.people);
    setDiscovery(discoveryResult);
    setSharedReferences(sharedResult.references);
    setOutgoingReferences(sharedResult.outgoing);
    setPins(pinResult.pins);
    setImportHistory(importResult.imports);
    setAssetStacks(stackResult.stacks);
    setReloadKey((current) => current + 1);
  };

  const loadMore = async () => {
    if (!nextAfter || loadingMore || collection === "groups") return;
    setLoadingMore(true);
    try {
      const result = await spacesApi.libraryItems(
        spaceId,
        { ...libraryQuery, after: nextAfter },
        sensitiveCollectionToken,
      );
      setItems((current) => [...current, ...result.items]);
      setVisibleItems((current) => [...current, ...result.items]);
      setNextAfter(result.next_after ?? "");
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "More Library items could not be loaded.",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const uploadFiles = async (paths: string[]) => {
    if (!canUploadLibrary || paths.length === 0) return;
    setLocalError("");
    const jobs = paths.map((path, index): LibraryUploadJob => ({
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
      path,
      name:
        path
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .pop() || "file",
      stage: "queued",
      progress: 0,
    }));
    setUploadJobs(jobs);
    const uploaded: SpaceLibraryItem[] = [];
    let cursor = 0;
    const updateJob = (id: string, patch: Partial<LibraryUploadJob>) => {
      setUploadJobs((current) =>
        current.map((job) => (job.id === id ? { ...job, ...patch } : job)),
      );
    };
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          const result = await spacesApi.uploadLibraryPath(spaceId, job.path, "library", {
            onStage: (stage) =>
              updateJob(job.id, { stage, progress: stage === "finalizing" ? 1 : 0 }),
            onProgress: (progress) => updateJob(job.id, { progress }),
          });
          if (result.item) uploaded.push(result.item);
          updateJob(job.id, { stage: "ready", progress: 1 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          updateJob(job.id, { stage: "failed", error: message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, () => worker()));
    await Promise.allSettled(
      detectUploadedAssetStacks(uploaded).map((input) =>
        spacesApi.createLibraryAssetStack(spaceId, input),
      ),
    );
    await reload();
  };

  const createSelectedAssetStack = async (kind: LibraryAssetStack["kind"]) => {
    if (!canEditLibrary) return;
    const input = buildLibraryAssetStack(kind, selectedItems);
    if (!input) {
      setLocalError(
        kind === "live_photo"
          ? "Select one image and one video to make a Live Photo."
          : kind === "raw_pair"
            ? "Select one RAW file and one rendered image to make a RAW pair."
            : "Select at least two images to make a burst.",
      );
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

  const duplicateItems = async (itemIDs: string[]) => {
    if (!canEditLibrary || !canCopyLibrary || itemIDs.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.duplicateLibraryItems(spaceId, itemIDs, sensitiveCollectionToken);
      setSelectedItemIds([]);
      await reload();
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "The selected Library items could not be duplicated.",
      );
    } finally {
      setBulkSaving(false);
    }
  };

  const copyItemsToClipboard = async (itemsToCopy: SpaceLibraryItem[]) => {
    if (!canCopyLibrary || itemsToCopy.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      await copyLibraryItemsToClipboard(spaceId, itemsToCopy, sensitiveCollectionToken);
      setSelectedItemIds([]);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "The selected Library items could not be copied.",
      );
    } finally {
      setBulkSaving(false);
    }
  };

  const copySharedReferenceToClipboard = async (reference: LibrarySharedReference) => {
    if (!canCopyLibrary || bulkSaving) return;
    setBulkSaving(true);
    setLocalError("");
    try {
      const blob = await spacesApi.sharedReferenceContent(spaceId, reference.id);
      await copyBlobFilesToClipboard([{ name: reference.display_name, blob }]);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "The shared Library item could not be copied.",
      );
    } finally {
      setBulkSaving(false);
    }
  };

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
    setBulkSaving(true);
    setLocalError("");
    try {
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
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The edits could not be pasted.");
    } finally {
      setBulkSaving(false);
    }
  };

  const setAssetStackCover = async (stack: LibraryAssetStack, coverItemID: string) => {
    try {
      const saved = await spacesApi.updateLibraryAssetStack(
        spaceId,
        stack,
        { cover_item_id: coverItemID },
        sensitiveCollectionToken,
      );
      setAssetStacks((current) =>
        current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
      );
      setSelectedItemId(saved.cover_item_id);
      await reload();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The key photo could not be changed.");
    }
  };

  const setAssetStackEffect = async (
    stack: LibraryAssetStack,
    effect: LibraryAssetStack["effect"],
  ) => {
    try {
      const saved = await spacesApi.updateLibraryAssetStack(
        spaceId,
        stack,
        { effect },
        sensitiveCollectionToken,
      );
      setAssetStacks((current) =>
        current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
      );
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "The Live Photo effect could not be changed.",
      );
    }
  };

  const ungroupAssetStack = async (stack: LibraryAssetStack) => {
    if (
      !(await confirmAction(
        `Separate this ${stack.kind === "live_photo" ? "Live Photo" : stack.kind === "raw_pair" ? "RAW pair" : "burst"}?`,
      ))
    )
      return;
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

  const updateItem = async (
    item: SpaceLibraryItem,
    patch: Partial<
      Pick<SpaceLibraryItem, "display_name" | "caption" | "favorite" | "hidden" | "tags">
    >,
  ) => {
    if (!canEditLibrary) return null;
    try {
      const saved = await spacesApi.updateLibraryItem(
        spaceId,
        item,
        patch,
        sensitiveCollectionToken,
      );
      const remainsVisible =
        collection === "hidden"
          ? saved.hidden
          : !saved.hidden && (collection !== "favorites" || saved.favorite);
      setItems((current) =>
        remainsVisible
          ? current.map((candidate) => (candidate.id === saved.id ? saved : candidate))
          : current.filter((candidate) => candidate.id !== saved.id),
      );
      setVisibleItems((current) =>
        remainsVisible
          ? current.map((candidate) => (candidate.id === saved.id ? saved : candidate))
          : current.filter((candidate) => candidate.id !== saved.id),
      );
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Library item could not be updated.");
      return null;
    }
  };

  const replaceItem = (saved: SpaceLibraryItem) => {
    setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    setVisibleItems((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  };

  const trashItem = async (item: SpaceLibraryItem) => {
    if (!canEditLibrary) return false;
    if (!(await confirmAction(`Move “${item.display_name}” to Recently Deleted?`))) return false;
    try {
      await spacesApi.trashLibraryItem(spaceId, item.id, sensitiveCollectionToken);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setVisibleItems((current) => current.filter((candidate) => candidate.id !== item.id));
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
      await spacesApi.restoreLibraryItem(spaceId, item.id, sensitiveCollectionToken);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setVisibleItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setSelectedItemId("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Library item could not be restored.");
    }
  };

  const toggleSelectedItem = (itemId: string) => {
    setSelectedItemIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    );
  };

  const appendSearchFacet = (key: "tag" | "type" | "album" | "year", value: string) => {
    const escapedValue = /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;
    setSearchInput((current) => `${current.trim()} ${key}:${escapedValue}`.trim());
  };

  const applyBulkAction = async (
    action: BulkLibraryItemAction,
    options: BulkLibraryItemOptions = {},
  ) => {
    if (!canEditLibrary || selectedItems.length === 0 || bulkSaving) return false;
    if (
      action === "trash" &&
      !(await confirmAction(
        `Move ${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"} to Recently Deleted?`,
      ))
    )
      return false;
    setBulkSaving(true);
    setLocalError("");
    try {
      await spacesApi.bulkLibraryItems(
        spaceId,
        selectedItems,
        action,
        options,
        sensitiveCollectionToken,
      );
      setSelectedItemIds([]);
      await reload();
      return true;
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Selected Library items could not be updated.",
      );
      return false;
    } finally {
      setBulkSaving(false);
    }
  };

  const openMetadataDialog = (action: "add_tags" | "remove_tags" | "set_date" | "set_location") => {
    setMetadataTags("");
    setMetadataDate("");
    setMetadataLocationName("");
    setMetadataLatitude("");
    setMetadataLongitude("");
    setMetadataDialogAction(action);
  };

  const saveBulkMetadata = async (event: FormEvent) => {
    event.preventDefault();
    if (!metadataDialogAction || bulkSaving) return;
    let options: BulkLibraryItemOptions = {};
    if (metadataDialogAction === "add_tags" || metadataDialogAction === "remove_tags") {
      const tags = metadataTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (tags.length === 0) return;
      options = { tags };
    } else if (metadataDialogAction === "set_date") {
      if (!metadataDate) return;
      options = { dateOverride: new Date(metadataDate).toISOString() };
    } else {
      const location: Record<string, unknown> = {};
      if (metadataLocationName.trim()) location.name = metadataLocationName.trim();
      if (metadataLatitude.trim()) {
        const latitude = Number(metadataLatitude);
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
          setLocalError("Latitude must be between -90 and 90.");
          return;
        }
        location.latitude = latitude;
      }
      if (metadataLongitude.trim()) {
        const longitude = Number(metadataLongitude);
        if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
          setLocalError("Longitude must be between -180 and 180.");
          return;
        }
        location.longitude = longitude;
      }
      if (Object.keys(location).length === 0) return;
      options = { locationOverride: location };
    }
    if (await applyBulkAction(metadataDialogAction, options)) setMetadataDialogAction("");
  };

  const clearBulkMetadata = async (action: "clear_date" | "clear_location", label: string) => {
    if (
      !(await confirmAction(
        `Clear ${label} from ${selectedItems.length} selected item${selectedItems.length === 1 ? "" : "s"}?`,
      ))
    )
      return;
    await applyBulkAction(action);
  };

  const requestSensitiveUnlock = (scope: "hidden" | "recently_deleted") => {
    setUnlockPassword("");
    setUnlockScope(scope);
  };

  const submitSensitiveUnlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!unlockScope || !unlockPassword || unlockSaving) return;
    setUnlockSaving(true);
    setLocalError("");
    try {
      const grant = await spacesApi.reauthenticateLibrary(spaceId, unlockScope, unlockPassword);
      setSensitiveGrants((current) => ({
        ...current,
        [unlockScope]: { token: grant.token, expiresAt: grant.expires_at },
      }));
      setUnlockScope("");
      setUnlockPassword("");
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "This collection could not be unlocked.",
      );
    } finally {
      setUnlockSaving(false);
    }
  };

  return {
    reload,
    loadMore,
    uploadFiles,
    createSelectedAssetStack,
    duplicateItems,
    copyItemsToClipboard,
    copySharedReferenceToClipboard,
    pasteEdits,
    setAssetStackCover,
    setAssetStackEffect,
    ungroupAssetStack,
    updateItem,
    replaceItem,
    trashItem,
    restoreItem,
    toggleSelectedItem,
    appendSearchFacet,
    applyBulkAction,
    openMetadataDialog,
    saveBulkMetadata,
    clearBulkMetadata,
    requestSensitiveUnlock,
    submitSensitiveUnlock,
  };
}

export type SpaceLibraryItemActions = ReturnType<typeof useSpaceLibraryItemActions>;
