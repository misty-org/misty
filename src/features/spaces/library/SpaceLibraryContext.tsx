import { createContext, useContext } from "react";
import type { SpaceLibraryCollectionActions } from "./hook-signatures/useSpaceLibraryCollectionActions";
import type { SpaceLibraryData } from "./hook-signatures/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "./hook-signatures/useSpaceLibraryItemActions";
import type { useOpenWith } from "./library-data/openWith";

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
  /** Opening a file: in the app last used for its kind, by asking which the first time, or in the preview. */
  openWith: Omit<ReturnType<typeof useOpenWith>, "dialog">;
}
