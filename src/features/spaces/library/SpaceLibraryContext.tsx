import { createContext, useContext } from "react";
import type { SpaceLibraryCollectionActions } from "./hook-signatures/useSpaceLibraryCollectionActions";
import type { SpaceLibraryData } from "./hook-signatures/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "./hook-signatures/useSpaceLibraryItemActions";

const SpaceLibraryContext = createContext<SpaceLibraryContextValue | null>(null);

export const SpaceLibraryProvider = SpaceLibraryContext.Provider;

export function useSpaceLibraryContext(): SpaceLibraryContextValue {
  const value = useContext(SpaceLibraryContext);
  if (!value) throw new Error("useSpaceLibraryContext must be used inside SpaceLibraryProvider");
  return value;
}

interface SpaceLibraryContextValue {
  data: SpaceLibraryData;
  itemActions: SpaceLibraryItemActions;
  collectionActions: SpaceLibraryCollectionActions;
}
