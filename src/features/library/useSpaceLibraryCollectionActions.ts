import { useLibraryCollectionRoute } from "./libraryCollections/useLibraryCollectionRoute";
import { useLibraryTextDialog } from "./libraryCollections/useLibraryTextDialog";
import type { SpaceLibraryData } from "./types/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "./types/useSpaceLibraryItemActions";

/** Everything the Library can do to a *collection*, as opposed to an item. */
export function useSpaceLibraryCollectionActions(
  data: SpaceLibraryData,
  itemActions: SpaceLibraryItemActions,
) {
  const selectCollection = useLibraryCollectionRoute(data);
  const textDialog = useLibraryTextDialog({ data, updateItem: itemActions.updateItem });
  return { selectCollection, ...textDialog };
}
