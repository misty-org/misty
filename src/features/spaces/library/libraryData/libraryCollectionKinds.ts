import type { LibraryCollectionKind } from "../types/useSpaceLibraryData";

/** Collections that may appear in `?collection=`; anything else falls back to Recent. */
export const libraryCollectionKinds = new Set<LibraryCollectionKind>([
  "recent",
  "months",
  "years",
  "recent-days",
  "utility",
  "collections",
  "favorites",
  "hidden",
  "deleted",
  "albums",
  "memory",
  "trip",
  "duplicate",
  "shared",
  "imports",
]);
