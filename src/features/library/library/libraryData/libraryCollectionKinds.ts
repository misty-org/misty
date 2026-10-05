import type { LibraryCollectionKind } from "../types/useSpaceLibraryData";

/** Collections that may appear in `?collection=`; anything else falls back to Recent. */
export const libraryCollectionKinds = new Set<LibraryCollectionKind>([
  "recent",
  "favorites",
  "deleted",
]);
