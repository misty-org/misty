import { createContext, useContext } from "react";
import type { SpaceLibraryCollectionActions } from "./types/useSpaceLibraryCollectionActions";
import type { SpaceLibraryData } from "./types/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "./types/useSpaceLibraryItemActions";

const SpaceLibraryContext = createContext<SpaceLibraryContextValue | null>(null);

export const SpaceLibraryProvider = SpaceLibraryContext.Provider;

export function useSpaceLibraryContext(): SpaceLibraryContextValue {
  const value = useContext(SpaceLibraryContext);
  if (!value) throw new Error("useSpaceLibraryContext must be used inside SpaceLibraryProvider");
  return value;
}

export interface SpaceLibraryContextValue {
  data: SpaceLibraryData;
  itemActions: SpaceLibraryItemActions;
  collectionActions: SpaceLibraryCollectionActions;
}
