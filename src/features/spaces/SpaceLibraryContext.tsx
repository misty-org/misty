import type { SpaceLibraryContextValue } from "@/models/interfaces/features/spaces/SpaceLibraryContext";
export type { SpaceLibraryContextValue } from "@/models/interfaces/features/spaces/SpaceLibraryContext";
import { createContext, useContext } from "react";
import type { SpaceLibraryCollectionActions } from "@/models/types/features/spaces/useSpaceLibraryCollectionActions";
import type { SpaceLibraryData } from "@/models/types/features/spaces/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "@/models/types/features/spaces/useSpaceLibraryItemActions";

const SpaceLibraryContext = createContext<SpaceLibraryContextValue | null>(null);

export const SpaceLibraryProvider = SpaceLibraryContext.Provider;

export function useSpaceLibraryContext(): SpaceLibraryContextValue {
  const value = useContext(SpaceLibraryContext);
  if (!value) throw new Error("useSpaceLibraryContext must be used inside SpaceLibraryProvider");
  return value;
}
