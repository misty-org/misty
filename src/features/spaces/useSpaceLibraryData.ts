export type {
  LibraryCollectionKind,
  LibraryUploadJob,
  SpaceLibraryData,
} from "@/models/types/features/spaces/useSpaceLibraryData";

import { useState } from "react";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { LibraryUploadJob } from "@/models/types/features/spaces/useSpaceLibraryData";
import { useLibraryCatalog } from "./libraryData/useLibraryCatalog";
import { useLibraryDerived } from "./libraryData/useLibraryDerived";
import { useLibraryDialogState } from "./libraryData/useLibraryDialogState";
import { useLibraryItems } from "./libraryData/useLibraryItems";
import { useLibrarySearch } from "./libraryData/useLibrarySearch";
import { useLibrarySelection } from "./libraryData/useLibrarySelection";
import { useLibrarySensitiveAccess } from "./libraryData/useLibrarySensitiveAccess";
import { useLibraryView } from "./libraryData/useLibraryView";

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
    onSensitiveGrantRejected: (scope) =>
      sensitive.setSensitiveGrants((grants) => ({ ...grants, [scope]: undefined })),
    setLocalError,
  });
  const selection = useLibrarySelection([
    view.collection,
    view.mediaType,
    search.searchQuery,
    view.selectedCollectionId,
    view.sort,
    view.direction,
    spaceId,
  ]);
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
