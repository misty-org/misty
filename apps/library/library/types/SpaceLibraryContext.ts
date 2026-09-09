import type { SpaceLibraryCollectionActions } from "./useSpaceLibraryCollectionActions";
import type { SpaceLibraryData } from "./useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "./useSpaceLibraryItemActions";

export interface SpaceLibraryContextValue {
  data: SpaceLibraryData;
  itemActions: SpaceLibraryItemActions;
  collectionActions: SpaceLibraryCollectionActions;
}
