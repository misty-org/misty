import { createContext, useContext } from "react";

import type { SpaceLibraryCollectionActions } from "./useSpaceLibraryCollectionActions";
import type { SpaceLibraryData } from "./useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "./useSpaceLibraryItemActions";

export interface SpaceLibraryContextValue {
  data: SpaceLibraryData;
  itemActions: SpaceLibraryItemActions;
  collectionActions: SpaceLibraryCollectionActions;
}

const SpaceLibraryContext = createContext<SpaceLibraryContextValue | null>(null);

export const SpaceLibraryProvider = SpaceLibraryContext.Provider;

export function useSpaceLibraryContext(): SpaceLibraryContextValue {
  const value = useContext(SpaceLibraryContext);
  if (!value) throw new Error("useSpaceLibraryContext must be used inside SpaceLibraryProvider");
  return value;
}
