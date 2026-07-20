import { createContext, useContext } from "react";
import type { SpaceLibraryCollectionActions } from "@/models/types/features/spaces/useSpaceLibraryCollectionActions";
import type { SpaceLibraryData } from "@/models/types/features/spaces/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "@/models/types/features/spaces/useSpaceLibraryItemActions";

export interface SpaceLibraryContextValue {
  data: SpaceLibraryData;
  itemActions: SpaceLibraryItemActions;
  collectionActions: SpaceLibraryCollectionActions;
}
