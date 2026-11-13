import { useLibraryCollectionRoute } from "./library-collections/useLibraryCollectionRoute";
import { useLibraryTextDialog } from "./library-collections/useLibraryTextDialog";
import type { SpaceLibraryData } from "./hook-signatures/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "./hook-signatures/useSpaceLibraryItemActions";

/** Everything the Library can do to a *collection*, as opposed to an item. */
export function useSpaceLibraryCollectionActions(
  data: SpaceLibraryData,
  itemActions: SpaceLibraryItemActions,
) {
  const selectCollection = useLibraryCollectionRoute(data);
  const textDialog = useLibraryTextDialog({ data, updateItem: itemActions.updateItem });
  return { selectCollection, ...textDialog };
}
