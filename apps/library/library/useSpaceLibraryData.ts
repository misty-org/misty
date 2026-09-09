export type {
  LibraryCollectionKind,
  LibraryUploadJob,
  SpaceLibraryData,
} from "./types/useSpaceLibraryData";

import { useLibrarySpaces as useSpacesStore } from "@/features/spaces/library/libraryRuntime";
import { useCallback, useState } from "react";
import { useLibraryCatalog } from "./libraryData/useLibraryCatalog";
import { useLibraryDerived } from "./libraryData/useLibraryDerived";
import { useLibraryDialogState } from "./libraryData/useLibraryDialogState";
import { useLibraryItems } from "./libraryData/useLibraryItems";
import { useLibrarySearch } from "./libraryData/useLibrarySearch";
import { useLibrarySelection } from "./libraryData/useLibrarySelection";
import {
  useLibrarySensitiveAccess,
  type SensitiveScope,
} from "./libraryData/useLibrarySensitiveAccess";
import { useLibraryView } from "./libraryData/useLibraryView";
import type { LibraryUploadJob } from "./types/useSpaceLibraryData";

export { libraryCollectionKinds } from "./libraryData/libraryCollectionKinds";

/**
 * All Library state for one Space, assembled from the slices in `libraryData/`.
 *
 * This hook owns nothing but the pieces that cross slice boundaries — the
 * reload key, upload jobs and the shared error — and flattens everything into
 * a single object, which is the shape every Library surface already consumes.
 */
export function useSpaceLibraryData(spaceId: string) {
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const permissions = activeSpace?.permissions;
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const canEditLibrary = !referenceOnly && permissions?.["library.edit"] !== false;

  const [reloadKey, setReloadKey] = useState(0);
  const [localError, setLocalError] = useState("");
  const [uploadJobs, setUploadJobs] = useState<LibraryUploadJob[]>([]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [memoryPlaybackOpen, setMemoryPlaybackOpen] = useState(false);

  const view = useLibraryView();
  const search = useLibrarySearch(spaceId);
  const dialogs = useLibraryDialogState();
  const catalog = useLibraryCatalog({ spaceId, reloadKey, setLocalError });
  const sensitive = useLibrarySensitiveAccess({
    spaceId,
    collection: view.collection,
    setLocalError,
  });
  // The item fetch keys off this callback, so an inline arrow would refetch on
  // every render — the requests then feed each other through their own state
  // updates until the server starts answering 429.
  const { setSensitiveGrants } = sensitive;
  const onSensitiveGrantRejected = useCallback(
    (scope: Exclude<SensitiveScope, "">) =>
      setSensitiveGrants((grants) => ({ ...grants, [scope]: undefined })),
    [setSensitiveGrants],
  );
  const itemList = useLibraryItems({
    spaceId,
    collection: view.collection,
    selectedCollectionId: view.selectedCollectionId,
    searchQuery: search.searchQuery,
    mediaType: view.mediaType,
    sort: view.sort,
    direction: view.direction,
    reloadKey,
    semanticSearchEnabled: Boolean(catalog.peoplePolicy?.semantic_search_enabled),
    sensitiveCollectionScope: sensitive.sensitiveCollectionScope,
    sensitiveCollectionToken: sensitive.sensitiveCollectionToken,
    onSensitiveGrantRejected,
    setLocalError,
  });
  const selection = useLibrarySelection(
    [
      view.collection,
      view.mediaType,
      search.searchQuery,
      view.selectedCollectionId,
      view.sort,
      view.direction,
      spaceId,
    ].join("\u0000"),
  );
  const derived = useLibraryDerived({
    assetStacks: catalog.assetStacks,
    visibleItems: itemList.visibleItems,
    selectedItemIds: selection.selectedItemIds,
    albums: catalog.albums,
    albumFolders: catalog.albumFolders,
    selectedAlbumFolderId: view.selectedAlbumFolderId,
    groups: catalog.groups,
    people: catalog.people,
    discovery: catalog.discovery,
    collection: view.collection,
    selectedCollectionId: view.selectedCollectionId,
    canEditLibrary,
    sort: view.sort,
    searchQuery: search.searchQuery,
    mediaType: view.mediaType,
  });

  return {
    spaceId,
    activeSpace,
    canUploadLibrary: !referenceOnly && permissions?.["library.upload"] !== false,
    canImportLibrary: !referenceOnly && permissions?.["library.import"] !== false,
    canEditLibrary,
    canCopyLibrary: permissions?.["library.download"] !== false,
    reloadKey,
    setReloadKey,
    localError,
    setLocalError,
    uploadJobs,
    setUploadJobs,
    filePickerOpen,
    setFilePickerOpen,
    memoryPlaybackOpen,
    setMemoryPlaybackOpen,
    ...view,
    ...search,
    ...dialogs,
    ...catalog,
    ...sensitive,
    ...itemList,
    ...selection,
    ...derived,
  };
}
