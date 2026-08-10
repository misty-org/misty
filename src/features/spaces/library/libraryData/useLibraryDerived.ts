import type {
  LibraryAlbum,
  LibraryAlbumFolder,
  LibraryAssetStack,
  LibraryDiscovery,
  LibraryGroup,
  LibraryItemQuery,
  LibraryPerson,
  SpaceLibraryItem,
} from "@/api/spaces/dto/interfaces/types";
import { useMemo } from "react";
import type { LibraryCollectionKind } from "../types/useSpaceLibraryData";

export interface LibraryDerivedOptions {
  assetStacks: LibraryAssetStack[];
  visibleItems: SpaceLibraryItem[];
  selectedItemIds: string[];
  albums: LibraryAlbum[];
  albumFolders: LibraryAlbumFolder[];
  selectedAlbumFolderId: string;
  groups: LibraryGroup[];
  people: LibraryPerson[];
  discovery: LibraryDiscovery;
  collection: LibraryCollectionKind;
  selectedCollectionId: string;
  canEditLibrary: boolean;
  sort: NonNullable<LibraryItemQuery["sort"]>;
  searchQuery: string;
  mediaType: string;
}

/**
 * Everything the Library reads but never stores.
 *
 * Stacked assets (Live Photos, RAW pairs) contribute only their cover to the
 * grid, so `displayItems` hides the other members while `stackByItemID` keeps
 * them reachable from whichever member is opened.
 */
export function useLibraryDerived(options: LibraryDerivedOptions) {
  const { assetStacks, visibleItems, selectedItemIds, albums, albumFolders } = options;
  const { selectedAlbumFolderId, groups, people, discovery } = options;
  const { collection, selectedCollectionId } = options;

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

  return {
    displayItems,
    stackByItemID,
    selectedItems,
    currentAlbum,
    currentDiscoveryGroup,
    currentDateGroup,
    currentAlbumFolder: albumFolders.find((folder) => folder.id === selectedAlbumFolderId) ?? null,
    visibleAlbumFolders: albumFolders.filter(
      (folder) => (folder.parent_folder_id ?? "") === selectedAlbumFolderId,
    ),
    visibleAlbumsForFolder: albums.filter(
      (album) => (album.folder_id ?? "") === selectedAlbumFolderId,
    ),
    currentGroup:
      collection === "groups" && selectedCollectionId
        ? (groups.find((group) => group.id === selectedCollectionId) ?? null)
        : null,
    currentPerson:
      collection === "people" && selectedCollectionId
        ? (people.find((person) => person.id === selectedCollectionId) ?? null)
        : null,
    // Custom ordering only applies when the whole album is on screen unsorted
    // and unfiltered — otherwise a drop would reorder against a partial list.
    canReorderAlbum: Boolean(
      options.canEditLibrary &&
      currentAlbum &&
      currentAlbum.sort_mode === "custom" &&
      options.sort === "album-order" &&
      !options.searchQuery &&
      !options.mediaType &&
      currentAlbum.item_count === visibleItems.length,
    ),
  };
}
