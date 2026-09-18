export type { SpaceLibraryCollectionActions } from "./types/useSpaceLibraryCollectionActions";

import { usePinnedDescriptor } from "./libraryCollections/libraryPinnedDescriptor";
import { useLibraryAlbumFolders } from "./libraryCollections/useLibraryAlbumFolders";
import { useLibraryAlbums } from "./libraryCollections/useLibraryAlbums";
import { useLibraryCollectionRoute } from "./libraryCollections/useLibraryCollectionRoute";
import { useLibraryMaintenance } from "./libraryCollections/useLibraryMaintenance";
import { useLibraryPeople } from "./libraryCollections/useLibraryPeople";
import { useLibraryPins } from "./libraryCollections/useLibraryPins";
import { useLibraryPolicies } from "./libraryCollections/useLibraryPolicies";
import { useLibraryTextDialog } from "./libraryCollections/useLibraryTextDialog";
import type { SpaceLibraryData } from "./types/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "./types/useSpaceLibraryItemActions";

/**
 * Everything the Library can do to a *collection*, as opposed to an item.
 *
 * Each concern lives in its own hook under `libraryCollections/`; this file
 * only wires them together and flattens the result into one object for the
 * Library surfaces to consume.
 */
export function useSpaceLibraryCollectionActions(
  data: SpaceLibraryData,
  itemActions: SpaceLibraryItemActions,
) {
  const selectCollection = useLibraryCollectionRoute(data);
  const pins = useLibraryPins(data);
  const pinnedDescriptor = usePinnedDescriptor(data, selectCollection);
  const albums = useLibraryAlbums(data, selectCollection);
  const albumFolders = useLibraryAlbumFolders(data);
  const people = useLibraryPeople(data, selectCollection);
  const policies = useLibraryPolicies(data);
  const maintenance = useLibraryMaintenance({
    data,
    selectCollection,
    reload: itemActions.reload,
  });
  const textDialog = useLibraryTextDialog({
    data,
    updateItem: itemActions.updateItem,
    updateCurrentMemory: maintenance.updateCurrentMemory,
  });

  return {
    selectCollection,
    pinnedDescriptor,
    ...pins,
    ...albums,
    ...albumFolders,
    ...people,
    ...policies,
    ...maintenance,
    ...textDialog,
  };
}
