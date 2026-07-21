import type { SpaceLibraryCollectionActions } from "@/models/types/features/spaces/useSpaceLibraryCollectionActions";
export type { SpaceLibraryCollectionActions } from "@/models/types/features/spaces/useSpaceLibraryCollectionActions";
import { useEffect, type FormEvent } from "react";
import {
  EyeOff,
  File,
  History,
  Image as ImageIcon,
  BookOpenText as LibraryIcon,
  Map as MapIcon,
  MapPin,
  MessagesSquare,
  Music2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { confirmAction } from "@/lib/confirmAction";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  LibraryPinnedCollection,
  LibrarySharedReference,
} from "@/models/interfaces/features/spaces/types";

import { libraryUtilityIcon } from "./SpaceLibraryPrimitives";
import { libraryCollectionKinds } from "./useSpaceLibraryData";
import type {
  LibraryCollectionKind,
  SpaceLibraryData,
} from "@/models/types/features/spaces/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "@/models/types/features/spaces/useSpaceLibraryItemActions";

export function useSpaceLibraryCollectionActions(
  data: SpaceLibraryData,
  itemActions: SpaceLibraryItemActions,
) {
  const {
    spaceId,
    librarySearchParams,
    setLibrarySearchParams,
    requestedCollection,
    requestedCollectionId,
    activeSpace,
    canEditLibrary,
    collection,
    setCollection,
    selectedCollectionId,
    setSelectedCollectionId,
    sort,
    setSort,
    setDirection,
    mediaType,
    setMediaType,
    albums,
    setAlbums,
    albumFolders,
    setAlbumFolders,
    selectedAlbumFolderId,
    setSelectedAlbumFolderId,
    groups,
    setGroups,
    people,
    setPeople,
    peoplePolicy,
    setPeoplePolicy,
    discovery,
    setDiscovery,
    sharedReferences,
    outgoingReferences,
    setOutgoingReferences,
    pins,
    setPins,
    importHistory,
    searchFacets,
    visibleItems,
    setVisibleItems,
    setItems,
    selectedItems,
    setSelectedItemIds,
    bulkSaving,
    setBulkSaving,
    setLocalError,
    currentAlbum,
    currentPerson,
    currentDiscoveryGroup,
    canReorderAlbum,
    draggedAlbumItemId,
    setDraggedAlbumItemId,
    albumDialogMode,
    setAlbumDialogMode,
    albumName,
    setAlbumName,
    albumDescription,
    setAlbumDescription,
    albumCoverItemId,
    setAlbumCoverItemId,
    albumSaving,
    setAlbumSaving,
    personDialogMode,
    setPersonDialogMode,
    personName,
    setPersonName,
    personKind,
    setPersonKind,
    personCoverItemId,
    setPersonCoverItemId,
    personSaving,
    setPersonSaving,
    textDialog,
    setTextDialog,
    textDialogSaving,
    setTextDialogSaving,
    setTextDialogError,
    showTextDialog,
    items,
    setReloadKey,
  } = data;
  const { reload, updateItem } = itemActions;

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

  const selectCollection = (next: LibraryCollectionKind, id = "") => {
    setCollection(next);
    setSelectedCollectionId(id);
    const nextSearchParams = new URLSearchParams(librarySearchParams);
    nextSearchParams.set("collection", next);
    if (id) nextSearchParams.set("collectionId", id);
    else nextSearchParams.delete("collectionId");
    if (nextSearchParams.toString() !== librarySearchParams.toString())
      setLibrarySearchParams(nextSearchParams, { replace: true });
    if (next === "albums" && id) {
      setSort("album-order");
      setDirection("asc");
    } else if (sort === "album-order") {
      setSort("recently-added");
      setDirection("desc");
    }
  };

  useEffect(() => {
    if (
      !requestedCollection ||
      !libraryCollectionKinds.has(requestedCollection as LibraryCollectionKind)
    )
      return;
    const nextCollection = requestedCollection as LibraryCollectionKind;
    setCollection(nextCollection);
    setSelectedCollectionId(requestedCollectionId);
    if (nextCollection === "albums" && requestedCollectionId) {
      setSort("album-order");
      setDirection("asc");
    } else {
      setSort((current) => (current === "album-order" ? "recently-added" : current));
    }
  }, [requestedCollection, requestedCollectionId]);
  const isPinned = (kind: LibraryPinnedCollection["target_kind"], id: string) =>
    pins.some((pin) => pin.target_kind === kind && pin.target_id === id);

  const togglePin = async (kind: LibraryPinnedCollection["target_kind"], id: string) => {
    if (!canEditLibrary) return;
    const exists = isPinned(kind, id);
    const targets = exists
      ? pins
          .filter((pin) => pin.target_kind !== kind || pin.target_id !== id)
          .map((pin) => ({ kind: pin.target_kind, id: pin.target_id }))
      : [...pins.map((pin) => ({ kind: pin.target_kind, id: pin.target_id })), { kind, id }];
    try {
      const result = await spacesApi.setLibraryPins(spaceId, targets);
      setPins(result.pins);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Pinned collections could not be updated.",
      );
    }
  };

  const movePin = async (pinID: string, delta: -1 | 1) => {
    if (!canEditLibrary) return;
    const index = pins.findIndex((pin) => pin.id === pinID);
    const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= pins.length) return;
    const reordered = [...pins];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    setPins(reordered.map((pin, position) => ({ ...pin, position })));
    try {
      const result = await spacesApi.setLibraryPins(
        spaceId,
        reordered.map((pin) => ({ kind: pin.target_kind, id: pin.target_id })),
      );
      setPins(result.pins);
    } catch (error) {
      setPins(pins);
      setLocalError(
        error instanceof Error ? error.message : "Pinned collections could not be reordered.",
      );
    }
  };

  const updateCurrentMemory = async (patch: {
    title?: string;
    cover_item_id?: string;
    music_item_id?: string;
    playback_seconds?: number;
  }) => {
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

  const pinnedDescriptor = (
    pin: LibraryPinnedCollection,
  ): { label: string; count: number; icon: LucideIcon; onClick: () => void } | null => {
    if (pin.target_kind === "album") {
      const album = albums.find((candidate) => candidate.id === pin.target_id);
      return album
        ? {
            label: album.name,
            count: album.item_count,
            icon: LibraryIcon,
            onClick: () => selectCollection("albums", album.id),
          }
        : null;
    }
    if (pin.target_kind === "group") {
      const group = groups.find((candidate) => candidate.id === pin.target_id);
      return group
        ? {
            label: group.name,
            count: group.rules.all.length,
            icon: SlidersHorizontal,
            onClick: () => selectCollection("groups", group.id),
          }
        : null;
    }
    if (pin.target_kind === "person") {
      const person = people.find((candidate) => candidate.id === pin.target_id);
      return person
        ? {
            label: person.name || (person.kind === "pet" ? "Unnamed pet" : "Unnamed person"),
            count: person.item_count,
            icon: Users,
            onClick: () => selectCollection("people", person.id),
          }
        : null;
    }
    if (pin.target_kind === "memory" || pin.target_kind === "trip") {
      const kind = pin.target_kind;
      const group = (kind === "memory" ? discovery.memories : discovery.trips).find(
        (candidate) => candidate.id === pin.target_id,
      );
      return group
        ? {
            label: group.title,
            count: group.item_count,
            icon: kind === "memory" ? Sparkles : MapPin,
            onClick: () => selectCollection(kind, group.id),
          }
        : null;
    }
    if (pin.target_kind === "map") {
      const point = discovery.map_points.find((candidate) => candidate.id === pin.target_id);
      return point
        ? {
            label: point.name,
            count: point.item_count,
            icon: MapIcon,
            onClick: () => selectCollection("map", point.id),
          }
        : null;
    }
    const system: Partial<
      Record<
        string,
        { label: string; count: number; icon: LucideIcon; collection: LibraryCollectionKind }
      >
    > = {
      recent: {
        label: "Recently Added",
        count: searchFacets.total,
        icon: LibraryIcon,
        collection: "recent",
      },
      months: {
        label: "Months",
        count: discovery.months.length,
        icon: History,
        collection: "months",
      },
      years: { label: "Years", count: discovery.years.length, icon: History, collection: "years" },
      "recent-days": {
        label: "Recent Days",
        count: discovery.recent_days.length,
        icon: LibraryIcon,
        collection: "recent-days",
      },
      favorites: {
        label: "Favorites",
        count: searchFacets.favorites,
        icon: Star,
        collection: "favorites",
      },
      people: { label: "People & Pets", count: people.length, icon: Users, collection: "people" },
      albums: { label: "Albums", count: albums.length, icon: LibraryIcon, collection: "albums" },
      groups: {
        label: "Groups",
        count: groups.length,
        icon: SlidersHorizontal,
        collection: "groups",
      },
      map: {
        label: "Map",
        count: discovery.map_points.reduce((total, point) => total + point.item_count, 0),
        icon: MapIcon,
        collection: "map",
      },
      shared: {
        label: "Shared",
        count: sharedReferences.length + outgoingReferences.length,
        icon: MessagesSquare,
        collection: "shared",
      },
      imports: {
        label: "Imports",
        count: importHistory.length,
        icon: History,
        collection: "imports",
      },
      hidden: { label: "Hidden", count: searchFacets.hidden, icon: EyeOff, collection: "hidden" },
      deleted: {
        label: "Recently Deleted",
        count: searchFacets.recently_deleted,
        icon: Trash2,
        collection: "deleted",
      },
    };
    const utility = searchFacets.utilities.find((facet) => facet.value === pin.target_id);
    if (utility)
      return {
        label: utility.label,
        count: utility.count,
        icon: libraryUtilityIcon(utility.value),
        onClick: () => selectCollection("utility", utility.value),
      };
    const media = searchFacets.media_types.find((facet) => facet.value === pin.target_id);
    if (media)
      return {
        label: media.label,
        count: media.count,
        icon:
          media.value === "image"
            ? ImageIcon
            : media.value === "video"
              ? Video
              : media.value === "audio"
                ? Music2
                : File,
        onClick: () => {
          setMediaType(media.value as typeof mediaType);
          selectCollection("recent");
        },
      };
    const descriptor = system[pin.target_id];
    return descriptor
      ? {
          label: descriptor.label,
          count: descriptor.count,
          icon: descriptor.icon,
          onClick: () => selectCollection(descriptor.collection),
        }
      : null;
  };

  const openCreateAlbum = () => {
    if (!canEditLibrary) return;
    setAlbumName("");
    setAlbumDescription("");
    setAlbumCoverItemId("");
    setAlbumDialogMode("create");
  };

  const openEditAlbum = () => {
    if (!canEditLibrary || !currentAlbum) return;
    setAlbumName(currentAlbum.name);
    setAlbumDescription(currentAlbum.description);
    setAlbumCoverItemId(currentAlbum.cover_item_id ?? "");
    setAlbumDialogMode("edit");
  };

  const saveAlbum = async (event: FormEvent) => {
    event.preventDefault();
    const name = albumName.trim();
    if (!canEditLibrary || !name || albumSaving) return;
    setAlbumSaving(true);
    try {
      if (albumDialogMode === "edit" && currentAlbum) {
        const saved = await spacesApi.updateAlbum(spaceId, currentAlbum, {
          name,
          description: albumDescription.trim(),
          cover_item_id: albumCoverItemId,
        });
        setAlbums((current) =>
          current
            .map((album) => (album.id === saved.id ? saved : album))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } else {
        let album = await spacesApi.createAlbum(spaceId, name, albumDescription.trim());
        if (selectedAlbumFolderId)
          album = await spacesApi.organizeAlbum(spaceId, album, {
            folder_id: selectedAlbumFolderId,
          });
        setAlbums((current) => [...current, album].sort((a, b) => a.name.localeCompare(b.name)));
        selectCollection("albums", album.id);
      }
      setAlbumDialogMode("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album could not be saved.");
    } finally {
      setAlbumSaving(false);
    }
  };

  const createAlbumFolder = () => {
    if (!canEditLibrary) return;
    showTextDialog({
      kind: "create-folder",
      title: "New album folder",
      primaryLabel: "Folder name",
      primaryValue: "",
    });
  };

  const renameAlbumFolder = () => {
    if (!canEditLibrary) return;
    const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
    if (!folder) return;
    showTextDialog({
      kind: "rename-folder",
      title: "Rename album folder",
      primaryLabel: "Folder name",
      primaryValue: folder.name,
    });
  };

  const deleteAlbumFolder = async () => {
    if (!canEditLibrary) return;
    const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
    if (
      !folder ||
      !(await confirmAction(`Delete “${folder.name}”? Albums will move to the top level.`))
    )
      return;
    try {
      await spacesApi.deleteAlbumFolder(spaceId, folder);
      setAlbumFolders((current) =>
        current.filter(
          (candidate) => candidate.id !== folder.id && candidate.parent_folder_id !== folder.id,
        ),
      );
      setAlbums((current) =>
        current.map((album) =>
          album.folder_id === folder.id ? { ...album, folder_id: undefined } : album,
        ),
      );
      setSelectedAlbumFolderId(folder.parent_folder_id ?? "");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album folder could not be deleted.");
    }
  };

  const deleteCurrentAlbum = async () => {
    if (
      !canEditLibrary ||
      !currentAlbum ||
      !(await confirmAction(
        `Delete “${currentAlbum.name}”? Its Library items will not be deleted.`,
      ))
    )
      return;
    try {
      await spacesApi.deleteAlbum(spaceId, currentAlbum);
      setAlbums((current) => current.filter((album) => album.id !== currentAlbum.id));
      selectCollection("collections");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album could not be deleted.");
    }
  };

  const reorderAlbumItem = async (targetItemId: string, movingItemId = draggedAlbumItemId) => {
    if (
      !canEditLibrary ||
      !currentAlbum ||
      !canReorderAlbum ||
      !movingItemId ||
      movingItemId === targetItemId
    )
      return;
    const nextItems = [...visibleItems];
    const from = nextItems.findIndex((item) => item.id === movingItemId);
    const to = nextItems.findIndex((item) => item.id === targetItemId);
    if (from < 0 || to < 0) return;
    const [moved] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, moved);
    setItems(nextItems);
    setVisibleItems(nextItems);
    setDraggedAlbumItemId("");
    try {
      const saved = await spacesApi.reorderAlbumItems(
        spaceId,
        currentAlbum,
        nextItems.map((item) => item.id),
      );
      setAlbums((current) => current.map((album) => (album.id === saved.id ? saved : album)));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album order could not be saved.");
      setReloadKey((current) => current + 1);
    }
  };

  const togglePeoplePolicy = async (kind: "person" | "pet") => {
    if (!canEditLibrary || !peoplePolicy) return;
    try {
      const saved = await spacesApi.updatePeoplePolicy(
        spaceId,
        peoplePolicy,
        kind === "person"
          ? { faces_enabled: !peoplePolicy.faces_enabled }
          : { pets_enabled: !peoplePolicy.pets_enabled },
      );
      setPeoplePolicy(saved);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "People & Pets settings could not be updated.",
      );
    }
  };

  const toggleIntelligencePolicy = async (kind: "ai" | "semantic") => {
    if (!canEditLibrary || !peoplePolicy) return;
    const patch =
      kind === "ai"
        ? {
            ai_enabled: !peoplePolicy.ai_enabled,
            ...(peoplePolicy.ai_enabled ? { semantic_search_enabled: false } : {}),
          }
        : {
            semantic_search_enabled: !peoplePolicy.semantic_search_enabled,
            ...(peoplePolicy.semantic_search_enabled ? {} : { ai_enabled: true }),
          };
    try {
      const saved = await spacesApi.updatePeoplePolicy(spaceId, peoplePolicy, patch);
      setPeoplePolicy(saved);
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "Library intelligence settings could not be updated.",
      );
    }
  };

  const openCreatePerson = (kind: "person" | "pet") => {
    if (!canEditLibrary) return;
    setPersonKind(kind);
    setPersonName("");
    setPersonCoverItemId("");
    setPersonDialogMode("create");
  };

  const openEditPerson = () => {
    if (!canEditLibrary || !currentPerson) return;
    setPersonKind(currentPerson.kind);
    setPersonName(currentPerson.name);
    setPersonCoverItemId(currentPerson.cover_item_id ?? "");
    setPersonDialogMode("edit");
  };

  const savePerson = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditLibrary || personSaving) return;
    setPersonSaving(true);
    try {
      if (personDialogMode === "edit" && currentPerson) {
        const saved = await spacesApi.updatePerson(spaceId, currentPerson, {
          name: personName.trim(),
          cover_item_id: personCoverItemId,
        });
        setPeople((current) => current.map((person) => (person.id === saved.id ? saved : person)));
      } else {
        const saved = await spacesApi.createPerson(spaceId, personKind, personName.trim());
        setPeople((current) => [...current, saved]);
        selectCollection("people", saved.id);
      }
      setPersonDialogMode("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Person or pet could not be saved.");
    } finally {
      setPersonSaving(false);
    }
  };

  const deleteCurrentPerson = async () => {
    if (
      !canEditLibrary ||
      !currentPerson ||
      !(await confirmAction(
        `Remove “${currentPerson.name || (currentPerson.kind === "pet" ? "Unnamed pet" : "Unnamed person")}" from People & Pets? Library items will not be deleted.`,
      ))
    )
      return;
    try {
      await spacesApi.deletePerson(spaceId, currentPerson);
      setPeople((current) => current.filter((person) => person.id !== currentPerson.id));
      selectCollection("people");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Person or pet could not be removed.");
    }
  };

  const mergeCurrentPerson = async (targetID: string) => {
    if (!canEditLibrary || !currentPerson || !targetID) return;
    const target = people.find((person) => person.id === targetID);
    if (
      !target ||
      !(await confirmAction(
        `Merge “${currentPerson.name || "Unnamed"}” into “${target.name || "Unnamed"}”?`,
      ))
    )
      return;
    try {
      const saved = await spacesApi.mergePeople(spaceId, currentPerson, target);
      setPeople((current) =>
        current
          .filter((person) => person.id !== currentPerson.id)
          .map((person) => (person.id === saved.id ? saved : person)),
      );
      selectCollection("people", saved.id);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "People could not be merged.");
    }
  };

  const applyPersonItems = async (personID: string, remove = false) => {
    if (!canEditLibrary || selectedItems.length === 0 || bulkSaving) return;
    setBulkSaving(true);
    try {
      const saved = remove
        ? await spacesApi.removePersonItems(
            spaceId,
            personID,
            selectedItems.map((item) => item.id),
          )
        : await spacesApi.addPersonItems(
            spaceId,
            personID,
            selectedItems.map((item) => item.id),
          );
      setPeople((current) => current.map((person) => (person.id === saved.id ? saved : person)));
      setSelectedItemIds([]);
      setReloadKey((current) => current + 1);
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Selected items could not be assigned.",
      );
    } finally {
      setBulkSaving(false);
    }
  };

  const createGroup = () => {
    if (!canEditLibrary) return;
    showTextDialog({
      kind: "create-group",
      title: "New smart group",
      primaryLabel: "Group name",
      primaryValue: "",
      secondaryLabel: "Match files with this tag",
      secondaryValue: "",
    });
  };

  const submitTextDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditLibrary || !textDialog || textDialogSaving) return;
    const primaryValue = textDialog.primaryValue.trim();
    const secondaryValue = textDialog.secondaryValue?.trim() ?? "";
    if (
      (textDialog.kind !== "edit-tags" && !primaryValue) ||
      (textDialog.secondaryLabel && !secondaryValue)
    )
      return;
    setTextDialogSaving(true);
    setTextDialogError("");
    try {
      if (textDialog.kind === "create-folder") {
        const folder = await spacesApi.createAlbumFolder(
          spaceId,
          primaryValue,
          selectedAlbumFolderId,
        );
        setAlbumFolders((current) =>
          [...current, folder].sort(
            (a, b) => a.position - b.position || a.name.localeCompare(b.name),
          ),
        );
        setSelectedAlbumFolderId(folder.id);
      } else if (textDialog.kind === "rename-folder") {
        const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
        if (!folder) throw new Error("This album folder is no longer available.");
        const saved = await spacesApi.updateAlbumFolder(spaceId, folder, { name: primaryValue });
        setAlbumFolders((current) =>
          current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
        );
      } else if (textDialog.kind === "create-group") {
        const group = await spacesApi.createGroup(spaceId, primaryValue, [
          { field: "tag", op: "contains", value: secondaryValue },
        ]);
        setGroups((current) => [...current, group].sort((a, b) => a.name.localeCompare(b.name)));
        selectCollection("groups", group.id);
      } else if (textDialog.kind === "rename-memory") {
        if (!(await updateCurrentMemory({ title: primaryValue })))
          throw new Error("The memory could not be renamed.");
      } else {
        const item = items.find((candidate) => candidate.id === textDialog.itemId);
        if (!item) throw new Error("This Library item is no longer available.");
        const updated =
          textDialog.kind === "rename-item"
            ? await updateItem(item, { display_name: primaryValue })
            : await updateItem(item, {
                tags: primaryValue
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              });
        if (!updated) throw new Error("The Library item could not be updated.");
      }
      setTextDialog(null);
    } catch (error) {
      setTextDialogError(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      setTextDialogSaving(false);
    }
  };

  return {
    mergeCurrentDuplicates,
    revokeSharedReference,
    selectCollection,
    isPinned,
    togglePin,
    movePin,
    updateCurrentMemory,
    pinnedDescriptor,
    openCreateAlbum,
    openEditAlbum,
    saveAlbum,
    createAlbumFolder,
    renameAlbumFolder,
    deleteAlbumFolder,
    deleteCurrentAlbum,
    reorderAlbumItem,
    togglePeoplePolicy,
    toggleIntelligencePolicy,
    openCreatePerson,
    openEditPerson,
    savePerson,
    deleteCurrentPerson,
    mergeCurrentPerson,
    applyPersonItems,
    createGroup,
    submitTextDialog,
  };
}
