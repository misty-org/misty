import { libraryApi as spacesApi } from "@/features/spaces/library/libraryRuntime";
import type {
  LibraryAlbum,
  LibraryAlbumFolder,
  LibraryAssetStack,
  LibraryDiscovery,
  LibraryGroup,
  LibraryImportHistoryItem,
  LibraryIntelligencePolicy,
  LibraryPerson,
  LibraryPinnedCollection,
  LibrarySharedReference,
  SpaceStorageUsage,
} from "@/api/spaces/dto/interfaces/types";
import { useCallback, useEffect, useState } from "react";

const emptyDiscovery: LibraryDiscovery = {
  recent_days: [],
  months: [],
  years: [],
  memories: [],
  trips: [],
  duplicates: [],
};

/**
 * Everything about the Library *except* the current item list.
 *
 * Loads in one pass on mount and whenever `reloadKey` changes; `refreshCatalog`
 * exposes the same pass as an awaitable call, so an action that just changed an
 * album or a person can pull fresh data without waiting for an effect.
 *
 * Only usage and albums are required — every other request falls back to an
 * empty result so one failing endpoint cannot blank the whole Library.
 */
export function useLibraryCatalog(options: {
  spaceId: string;
  reloadKey: number;
  setLocalError: (message: string) => void;
}) {
  const { spaceId, reloadKey, setLocalError } = options;
  const [usage, setUsage] = useState<SpaceStorageUsage | null>(null);
  const [assetStacks, setAssetStacks] = useState<LibraryAssetStack[]>([]);
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [albumFolders, setAlbumFolders] = useState<LibraryAlbumFolder[]>([]);
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [people, setPeople] = useState<LibraryPerson[]>([]);
  const [peoplePolicy, setPeoplePolicy] = useState<LibraryIntelligencePolicy | null>(null);
  const [discovery, setDiscovery] = useState<LibraryDiscovery>(emptyDiscovery);
  const [sharedReferences, setSharedReferences] = useState<LibrarySharedReference[]>([]);
  const [outgoingReferences, setOutgoingReferences] = useState<LibrarySharedReference[]>([]);
  const [pins, setPins] = useState<LibraryPinnedCollection[]>([]);
  const [importHistory, setImportHistory] = useState<LibraryImportHistoryItem[]>([]);

  const refreshCatalog = useCallback(
    async (isCancelled: () => boolean = () => false) => {
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
        spacesApi.libraryDiscovery(spaceId).catch(() => emptyDiscovery),
        spacesApi.sharedReferences(spaceId).catch(() => ({ references: [], outgoing: [] })),
        spacesApi.libraryPins(spaceId).catch(() => ({ pins: [] })),
        spacesApi.libraryImportHistory(spaceId).catch(() => ({ imports: [] })),
        spacesApi.libraryAssetStacks(spaceId).catch(() => ({ stacks: [] })),
      ]);
      if (isCancelled()) return;
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
    [spaceId],
  );

  useEffect(() => {
    let current = true;
    void refreshCatalog(() => !current).catch(
      (error: unknown) =>
        current &&
        setLocalError(error instanceof Error ? error.message : "Library could not be loaded."),
    );
    return () => {
      current = false;
    };
  }, [refreshCatalog, reloadKey, setLocalError]);

  return {
    refreshCatalog,
    usage,
    setUsage,
    assetStacks,
    setAssetStacks,
    albums,
    setAlbums,
    albumFolders,
    setAlbumFolders,
    groups,
    setGroups,
    people,
    setPeople,
    peoplePolicy,
    setPeoplePolicy,
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
  };
}
