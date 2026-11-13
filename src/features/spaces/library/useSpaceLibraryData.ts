import { useSpacesStore } from "@/features/spaces/core";
import { useEffect, useState } from "react";
import { spacesResyncEvent } from "../list/spacesResync";
import { useLibraryCatalog } from "./library-data/useLibraryCatalog";
import { useLibraryDerived } from "./library-data/useLibraryDerived";
import { useLibraryDialogState } from "./library-data/useLibraryDialogState";
import { useLibraryItems } from "./library-data/useLibraryItems";
import { useLibrarySearch } from "./library-data/useLibrarySearch";
import { useLibrarySelection } from "./library-data/useLibrarySelection";
import { useLibraryView } from "./library-data/useLibraryView";
import type { LibraryUploadJob } from "./hook-signatures/useSpaceLibraryData";

export { libraryCollectionKinds } from "./library-data/libraryCollectionKinds";

/**
 * All Library state for one Space, assembled from the slices in `library-data/`.
 *
 * It owns nothing but the pieces that cross slice boundaries — the
 * reload key, upload jobs and the shared error — and flattens everything into
 * a single object, which is the shape every Library surface already consumes.
 * Every member can do everything here; only reconnecting makes it read-only.
 */
export function useSpaceLibraryData(spaceId: string) {
  const activeSpace = useSpacesStore((state) => state.spaces.find((space) => space.id === spaceId));
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const canEditLibrary = !referenceOnly;

  const [reloadKey, setReloadKey] = useState(0);
  // What another member does here (an upload, a rename, a deletion, hiding an item) shows without
  // a reload: the list and its counts read again, once for a burst of changes. Missed events
  // (`spacesResyncEvent`) read it again too.
  useEffect(() => {
    let timer = 0;
    const reload = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setReloadKey((key) => key + 1), 300);
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId) reload();
    };
    window.addEventListener("misty:space-library-event", changed);
    window.addEventListener(spacesResyncEvent, reload);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("misty:space-library-event", changed);
      window.removeEventListener(spacesResyncEvent, reload);
    };
  }, [spaceId]);
  const [localError, setLocalError] = useState("");
  const [uploadJobs, setUploadJobs] = useState<LibraryUploadJob[]>([]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);

  const view = useLibraryView();
  const search = useLibrarySearch(spaceId);
  const dialogs = useLibraryDialogState();
  const catalog = useLibraryCatalog({ spaceId, reloadKey, setLocalError });
  const itemList = useLibraryItems({
    spaceId,
    collection: view.collection,
    searchQuery: search.searchQuery,
    mediaType: view.mediaType,
    sort: view.sort,
    direction: view.direction,
    reloadKey,
    setLocalError,
  });
  const selection = useLibrarySelection(
    [view.collection, view.mediaType, search.searchQuery, view.sort, view.direction, spaceId].join(
      "\u0000",
    ),
  );
  const derived = useLibraryDerived({
    visibleItems: itemList.visibleItems,
    selectedItemIds: selection.selectedItemIds,
  });

  return {
    spaceId,
    activeSpace,
    canUploadLibrary: canEditLibrary,
    canEditLibrary,
    reloadKey,
    setReloadKey,
    localError,
    setLocalError,
    uploadJobs,
    setUploadJobs,
    filePickerOpen,
    setFilePickerOpen,
    ...view,
    ...search,
    ...dialogs,
    ...catalog,
    ...itemList,
    ...selection,
    ...derived,
  };
}
