import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { SpaceRequestError, spacesApi } from "@/spaces/api";
import type {
  LibraryAlbum,
  LibraryAlbumFolder,
  LibraryAssetStack,
  LibraryDiscovery,
  LibraryEditDefinition,
  LibraryGroup,
  LibraryImportHistoryItem,
  LibraryIntelligencePolicy,
  LibraryItemQuery,
  LibraryPerson,
  LibraryPinnedCollection,
  LibrarySearchFacets,
  LibrarySharedReference,
  SpaceLibraryItem,
  SpaceStorageUsage,
} from "@/spaces/types";
import { useSpacesStore } from "@/stores/useSpacesStore";

import type { LibraryItemMenuState } from "./components/LibraryItemContextMenu";
import { compareLibraryItems, libraryFacetPrefix } from "./libraryFormat";
import {
  type LibraryAlbumDialogMode,
  type LibraryMetadataDialogAction,
  type LibraryPersonDialogMode,
  type LibraryTextDialogState,
  type LibraryUnlockScope,
} from "./SpaceLibraryDialogs";
import { activeSensitiveGrant, libraryItemMIME } from "./SpaceLibraryPrimitives";

export type LibraryCollectionKind =
  | "recent"
  | "months"
  | "years"
  | "recent-days"
  | "utility"
  | "collections"
  | "favorites"
  | "hidden"
  | "deleted"
  | "people"
  | "albums"
  | "groups"
  | "memory"
  | "trip"
  | "map"
  | "duplicate"
  | "shared"
  | "imports";

export const libraryCollectionKinds = new Set<LibraryCollectionKind>([
  "recent",
  "months",
  "years",
  "recent-days",
  "utility",
  "collections",
  "favorites",
  "hidden",
  "deleted",
  "people",
  "albums",
  "groups",
  "memory",
  "trip",
  "map",
  "duplicate",
  "shared",
  "imports",
]);

export type LibraryUploadJob = {
  id: string;
  path: string;
  name: string;
  stage: "queued" | "reading" | "hashing" | "uploading" | "finalizing" | "ready" | "failed";
  progress: number;
  error?: string;
};

export function useSpaceLibraryData(spaceId: string) {
  const [librarySearchParams, setLibrarySearchParams] = useSearchParams();
  const requestedCollection = librarySearchParams.get("collection");
  const requestedCollectionId = librarySearchParams.get("collectionId") ?? "";
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const permissions = activeSpace?.permissions;
  const canUploadLibrary = permissions?.["library.upload"] !== false;
  const canEditLibrary = permissions?.["library.edit"] !== false;
  const canCopyLibrary = permissions?.["library.download"] !== false;
  const [items, setItems] = useState<SpaceLibraryItem[]>([]);
  const [visibleItems, setVisibleItems] = useState<SpaceLibraryItem[]>([]);
  const [usage, setUsage] = useState<SpaceStorageUsage | null>(null);
  const [assetStacks, setAssetStacks] = useState<LibraryAssetStack[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [albumFolders, setAlbumFolders] = useState<LibraryAlbumFolder[]>([]);
  const [selectedAlbumFolderId, setSelectedAlbumFolderId] = useState("");
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [people, setPeople] = useState<LibraryPerson[]>([]);
  const [peoplePolicy, setPeoplePolicy] = useState<LibraryIntelligencePolicy | null>(null);
  const [collection, setCollection] = useState<LibraryCollectionKind>("recent");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFacets, setSearchFacets] = useState<LibrarySearchFacets>({
    total: 0,
    favorites: 0,
    hidden: 0,
    recently_deleted: 0,
    tags: [],
    media_types: [],
    years: [],
    albums: [],
    utilities: [],
  });
  const [discovery, setDiscovery] = useState<LibraryDiscovery>({
    recent_days: [],
    months: [],
    years: [],
    memories: [],
    trips: [],
    duplicates: [],
    map_points: [],
  });
  const [sharedReferences, setSharedReferences] = useState<LibrarySharedReference[]>([]);
  const [outgoingReferences, setOutgoingReferences] = useState<LibrarySharedReference[]>([]);
  const [pins, setPins] = useState<LibraryPinnedCollection[]>([]);
  const [importHistory, setImportHistory] = useState<LibraryImportHistoryItem[]>([]);
  const [memoryPlaybackOpen, setMemoryPlaybackOpen] = useState(false);
  const [memoryAudioItems, setMemoryAudioItems] = useState<SpaceLibraryItem[]>([]);
  const [mediaType, setMediaType] = useState<"" | NonNullable<LibraryItemQuery["media_type"]>>("");
  const [libraryViewMode, setLibraryViewMode] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<NonNullable<LibraryItemQuery["sort"]>>("recently-added");
  const [direction, setDirection] = useState<NonNullable<LibraryItemQuery["direction"]>>("desc");
  const [reloadKey, setReloadKey] = useState(0);
  const [nextAfter, setNextAfter] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadJobs, setUploadJobs] = useState<LibraryUploadJob[]>([]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const libraryViewerTriggerRef = useRef<HTMLElement | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [itemMenu, setItemMenu] = useState<LibraryItemMenuState | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [copiedEditDefinition, setCopiedEditDefinition] = useState<LibraryEditDefinition | null>(
    null,
  );
  const [sensitiveGrants, setSensitiveGrants] = useState<
    Partial<Record<"hidden" | "recently_deleted", { token: string; expiresAt: string }>>
  >({});
  const [unlockScope, setUnlockScope] = useState<LibraryUnlockScope>("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockSaving, setUnlockSaving] = useState(false);
  const [metadataDialogAction, setMetadataDialogAction] = useState<LibraryMetadataDialogAction>("");
  const [metadataTags, setMetadataTags] = useState("");
  const [metadataDate, setMetadataDate] = useState("");
  const [metadataLocationName, setMetadataLocationName] = useState("");
  const [metadataLatitude, setMetadataLatitude] = useState("");
  const [metadataLongitude, setMetadataLongitude] = useState("");
  const [albumDialogMode, setAlbumDialogMode] = useState<LibraryAlbumDialogMode>("");
  const [albumName, setAlbumName] = useState("");
  const [albumDescription, setAlbumDescription] = useState("");
  const [albumCoverItemId, setAlbumCoverItemId] = useState("");
  const [albumSaving, setAlbumSaving] = useState(false);
  const [draggedAlbumItemId, setDraggedAlbumItemId] = useState("");
  const [personDialogMode, setPersonDialogMode] = useState<LibraryPersonDialogMode>("");
  const [personName, setPersonName] = useState("");
  const [personKind, setPersonKind] = useState<"person" | "pet">("person");
  const [personCoverItemId, setPersonCoverItemId] = useState("");
  const [personSaving, setPersonSaving] = useState(false);
  const [textDialog, setTextDialog] = useState<LibraryTextDialogState | null>(null);
  const [textDialogSaving, setTextDialogSaving] = useState(false);
  const [textDialogError, setTextDialogError] = useState("");
  const hiddenStackMemberIDs = useMemo(
    () =>
      new Set(
        assetStacks.flatMap((stack) =>
          stack.members
            .filter((member) => member.item_id !== stack.cover_item_id)
            .map((member) => member.item_id),
        ),
      ),
    [assetStacks],
  );
  const displayItems = useMemo(
    () => visibleItems.filter((item) => !hiddenStackMemberIDs.has(item.id)),
    [hiddenStackMemberIDs, visibleItems],
  );
  const stackByItemID = useMemo(
    () =>
      new Map(
        assetStacks.flatMap((stack) =>
          stack.members.map((member) => [member.item_id, stack] as const),
        ),
      ),
    [assetStacks],
  );
  const selectedItems = useMemo(
    () => displayItems.filter((item) => selectedItemIds.includes(item.id)),
    [displayItems, selectedItemIds],
  );
  const currentAlbum = useMemo(
    () =>
      collection === "albums" && selectedCollectionId
        ? (albums.find((album) => album.id === selectedCollectionId) ?? null)
        : null,
    [albums, collection, selectedCollectionId],
  );
  const currentAlbumFolder = useMemo(
    () => albumFolders.find((folder) => folder.id === selectedAlbumFolderId) ?? null,
    [albumFolders, selectedAlbumFolderId],
  );
  const visibleAlbumFolders = useMemo(
    () =>
      albumFolders.filter((folder) => (folder.parent_folder_id ?? "") === selectedAlbumFolderId),
    [albumFolders, selectedAlbumFolderId],
  );
  const visibleAlbumsForFolder = useMemo(
    () => albums.filter((album) => (album.folder_id ?? "") === selectedAlbumFolderId),
    [albums, selectedAlbumFolderId],
  );
  const currentGroup = useMemo(
    () =>
      collection === "groups" && selectedCollectionId
        ? (groups.find((group) => group.id === selectedCollectionId) ?? null)
        : null,
    [collection, groups, selectedCollectionId],
  );
  const currentPerson = useMemo(
    () =>
      collection === "people" && selectedCollectionId
        ? (people.find((person) => person.id === selectedCollectionId) ?? null)
        : null,
    [collection, people, selectedCollectionId],
  );
  const currentDiscoveryGroup = useMemo(
    () =>
      collection === "memory"
        ? (discovery.memories.find((group) => group.id === selectedCollectionId) ?? null)
        : collection === "trip"
          ? (discovery.trips.find((group) => group.id === selectedCollectionId) ?? null)
          : collection === "duplicate"
            ? (discovery.duplicates.find((group) => group.id === selectedCollectionId) ?? null)
            : null,
    [collection, discovery, selectedCollectionId],
  );
  const currentDateGroup = useMemo(
    () =>
      collection === "recent-days"
        ? (discovery.recent_days.find((group) => group.id === selectedCollectionId) ?? null)
        : collection === "months"
          ? (discovery.months.find((group) => group.id === selectedCollectionId) ?? null)
          : collection === "years"
            ? (discovery.years.find((group) => group.id === selectedCollectionId) ?? null)
            : null,
    [collection, discovery.months, discovery.recent_days, discovery.years, selectedCollectionId],
  );
  const currentMapPoint = useMemo(
    () =>
      collection === "map" && selectedCollectionId
        ? (discovery.map_points.find((point) => point.id === selectedCollectionId) ?? null)
        : null,
    [collection, discovery.map_points, selectedCollectionId],
  );
  const canReorderAlbum = Boolean(
    canEditLibrary &&
    currentAlbum &&
    currentAlbum.sort_mode === "custom" &&
    sort === "album-order" &&
    !searchQuery &&
    !mediaType &&
    currentAlbum.item_count === visibleItems.length,
  );
  const sensitiveCollectionScope: "" | "hidden" | "recently_deleted" =
    collection === "hidden" ? "hidden" : collection === "deleted" ? "recently_deleted" : "";
  const sensitiveCollectionToken = sensitiveCollectionScope
    ? activeSensitiveGrant(sensitiveGrants[sensitiveCollectionScope])
    : "";
  const closeSensitiveUnlock = () => {
    if (unlockSaving) return;
    setUnlockScope("");
    setUnlockPassword("");
    setLocalError("");
  };
  const showTextDialog = (dialog: LibraryTextDialogState) => {
    setTextDialogError("");
    setTextDialog(dialog);
  };

  useEffect(() => {
    setSensitiveGrants({});
    setUnlockScope("");
    setUnlockPassword("");
  }, [spaceId]);

  useEffect(() => {
    const handleLibraryEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id === spaceId) setReloadKey((current) => current + 1);
    };
    window.addEventListener("misty:space-library-event", handleLibraryEvent);
    return () => window.removeEventListener("misty:space-library-event", handleLibraryEvent);
  }, [spaceId]);

  useEffect(() => {
    const expirations = Object.values(sensitiveGrants)
      .map((grant) => (grant?.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN))
      .filter(Number.isFinite);
    if (expirations.length === 0) return;
    const delay = Math.max(0, Math.min(...expirations) - Date.now());
    const timer = window.setTimeout(
      () =>
        setSensitiveGrants(
          (current) =>
            Object.fromEntries(
              Object.entries(current).filter(([, grant]) => activeSensitiveGrant(grant) !== ""),
            ) as typeof current,
        ),
      delay + 25,
    );
    return () => window.clearTimeout(timer);
  }, [sensitiveGrants]);

  const libraryQuery = useMemo<LibraryItemQuery>(
    () => ({
      q: searchQuery,
      sort,
      direction,
      media_type: mediaType || undefined,
      utility:
        collection === "utility" && selectedCollectionId
          ? (selectedCollectionId as LibraryItemQuery["utility"])
          : undefined,
      visibility: collection === "hidden" ? "hidden" : "visible",
      collection: collection === "deleted" ? "recently-deleted" : undefined,
      favorite: collection === "favorites",
      album_id: collection === "albums" && selectedCollectionId ? selectedCollectionId : undefined,
    }),
    [collection, direction, mediaType, searchQuery, selectedCollectionId, sort],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void spacesApi
        .libraryFacets(spaceId, libraryFacetPrefix(searchInput))
        .then((facets) => current && setSearchFacets(facets))
        .catch(
          () =>
            current &&
            setSearchFacets({
              total: 0,
              favorites: 0,
              hidden: 0,
              recently_deleted: 0,
              tags: [],
              media_types: [],
              years: [],
              albums: [],
              utilities: [],
            }),
        );
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [searchInput, spaceId]);

  useEffect(() => {
    let current = true;
    void Promise.all([
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
    ])
      .then(
        ([
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
        ]) => {
          if (!current) return;
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
        },
      )
      .catch(
        (error: unknown) =>
          current &&
          setLocalError(error instanceof Error ? error.message : "Library could not be loaded."),
      );
    return () => {
      current = false;
    };
  }, [reloadKey, spaceId]);

  useEffect(() => {
    let current = true;
    if (sensitiveCollectionScope && !sensitiveCollectionToken) {
      setItems([]);
      setVisibleItems([]);
      setLoading(false);
      return () => {
        current = false;
      };
    }
    if (
      collection === "collections" ||
      collection === "shared" ||
      collection === "imports" ||
      ((collection === "recent-days" ||
        collection === "months" ||
        collection === "years" ||
        collection === "people" ||
        collection === "albums" ||
        collection === "groups" ||
        collection === "duplicate" ||
        collection === "map") &&
        !selectedCollectionId)
    ) {
      setItems([]);
      setVisibleItems([]);
      setLoading(false);
      return () => {
        current = false;
      };
    }
    setLoading(true);
    setLocalError("");
    const dateDiscoveryKind =
      collection === "recent-days"
        ? "day"
        : collection === "months"
          ? "month"
          : collection === "years"
            ? "year"
            : null;
    const semanticSearch =
      collection === "recent" &&
      Boolean(searchQuery) &&
      !searchQuery.includes(":") &&
      !mediaType &&
      Boolean(peoplePolicy?.semantic_search_enabled);
    const request = semanticSearch
      ? spacesApi
          .semanticLibrarySearch(spaceId, searchQuery)
          .catch(() => spacesApi.libraryItems(spaceId, libraryQuery))
      : dateDiscoveryKind
        ? spacesApi.discoveryItems(spaceId, dateDiscoveryKind, selectedCollectionId)
        : collection === "memory" ||
            collection === "trip" ||
            collection === "duplicate" ||
            collection === "map"
          ? spacesApi.discoveryItems(spaceId, collection, selectedCollectionId)
          : collection === "people"
            ? spacesApi.personItems(spaceId, selectedCollectionId)
            : collection === "groups"
              ? spacesApi.groupItems(spaceId, selectedCollectionId)
              : collection === "albums" && selectedCollectionId
                ? spacesApi.albumItems(spaceId, selectedCollectionId)
                : spacesApi.libraryItems(spaceId, libraryQuery, sensitiveCollectionToken);
    void request
      .then((library) => {
        if (!current) return;
        let nextItems = library.items;
        if (
          collection === "recent-days" ||
          collection === "months" ||
          collection === "years" ||
          collection === "people" ||
          collection === "groups" ||
          collection === "memory" ||
          collection === "trip" ||
          collection === "map" ||
          collection === "duplicate" ||
          (collection === "albums" && selectedCollectionId)
        ) {
          const normalizedSearch = searchQuery.toLocaleLowerCase();
          nextItems = nextItems.filter((item) => {
            const mime = libraryItemMIME(item);
            const matchesSearch =
              !normalizedSearch ||
              [item.display_name, item.caption, item.tags.join(" "), item.file.original_filename]
                .join(" ")
                .toLocaleLowerCase()
                .includes(normalizedSearch);
            const matchesMedia =
              !mediaType || mediaType === "document"
                ? !mediaType || !/^(image|video|audio)\//.test(mime)
                : mime.startsWith(`${mediaType}/`);
            return matchesSearch && matchesMedia;
          });
          if (sort !== "album-order")
            nextItems.sort((left, right) => compareLibraryItems(left, right, sort, direction));
        }
        setItems(nextItems);
        setVisibleItems(nextItems);
        setNextAfter(
          collection === "recent-days" ||
            collection === "months" ||
            collection === "years" ||
            collection === "people" ||
            collection === "groups" ||
            collection === "memory" ||
            collection === "trip" ||
            collection === "map" ||
            collection === "duplicate" ||
            (collection === "albums" && selectedCollectionId)
            ? ""
            : ((library as { next_after?: string }).next_after ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (
          error instanceof SpaceRequestError &&
          error.code === "library_reauthentication_required" &&
          sensitiveCollectionScope
        ) {
          setSensitiveGrants((grants) => ({ ...grants, [sensitiveCollectionScope]: undefined }));
          return;
        }
        setLocalError(error instanceof Error ? error.message : "Library could not be loaded.");
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [
    collection,
    libraryQuery,
    mediaType,
    peoplePolicy?.semantic_search_enabled,
    reloadKey,
    searchQuery,
    selectedCollectionId,
    sensitiveCollectionScope,
    sensitiveCollectionToken,
    sort,
    direction,
    spaceId,
  ]);

  useEffect(() => {
    if (collection !== "memory" || !selectedCollectionId) {
      setMemoryAudioItems([]);
      return;
    }
    let current = true;
    void spacesApi
      .libraryItems(spaceId, { media_type: "audio", limit: 200 })
      .then((result) => current && setMemoryAudioItems(result.items))
      .catch(() => current && setMemoryAudioItems([]));
    return () => {
      current = false;
    };
  }, [collection, selectedCollectionId, spaceId]);

  useEffect(() => {
    setSelectedItemIds([]);
  }, [collection, mediaType, searchQuery, selectedCollectionId, sort, direction, spaceId]);

  return {
    spaceId,
    librarySearchParams,
    setLibrarySearchParams,
    requestedCollection,
    requestedCollectionId,
    activeSpace,
    canUploadLibrary,
    canEditLibrary,
    canCopyLibrary,
    items,
    setItems,
    visibleItems,
    setVisibleItems,
    usage,
    setUsage,
    assetStacks,
    setAssetStacks,
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
    collection,
    setCollection,
    selectedCollectionId,
    setSelectedCollectionId,
    searchInput,
    setSearchInput,
    searchQuery,
    setSearchQuery,
    searchFocused,
    setSearchFocused,
    searchFacets,
    discovery,
    setDiscovery,
    sharedReferences,
    setSharedReferences,
    outgoingReferences,
    setOutgoingReferences,
    pins,
    setPins,
    importHistory,
    setImportHistory,
    memoryPlaybackOpen,
    setMemoryPlaybackOpen,
    memoryAudioItems,
    mediaType,
    setMediaType,
    libraryViewMode,
    setLibraryViewMode,
    sort,
    setSort,
    direction,
    setDirection,
    reloadKey,
    setReloadKey,
    nextAfter,
    setNextAfter,
    loadingMore,
    setLoadingMore,
    loading,
    uploadJobs,
    setUploadJobs,
    filePickerOpen,
    setFilePickerOpen,
    localError,
    setLocalError,
    selectedItemId,
    setSelectedItemId,
    libraryViewerTriggerRef,
    selectedItemIds,
    setSelectedItemIds,
    itemMenu,
    setItemMenu,
    bulkSaving,
    setBulkSaving,
    copiedEditDefinition,
    setCopiedEditDefinition,
    sensitiveGrants,
    setSensitiveGrants,
    unlockScope,
    setUnlockScope,
    unlockPassword,
    setUnlockPassword,
    unlockSaving,
    setUnlockSaving,
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
    draggedAlbumItemId,
    setDraggedAlbumItemId,
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
    textDialogError,
    setTextDialogError,
    displayItems,
    stackByItemID,
    selectedItems,
    currentAlbum,
    currentAlbumFolder,
    visibleAlbumFolders,
    visibleAlbumsForFolder,
    currentGroup,
    currentPerson,
    currentDiscoveryGroup,
    currentDateGroup,
    currentMapPoint,
    canReorderAlbum,
    sensitiveCollectionScope,
    sensitiveCollectionToken,
    libraryQuery,
    closeSensitiveUnlock,
    showTextDialog,
  };
}

export type SpaceLibraryData = ReturnType<typeof useSpaceLibraryData>;
