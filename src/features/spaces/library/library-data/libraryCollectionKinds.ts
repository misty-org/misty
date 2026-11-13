import type { LibraryCollectionKind } from "../hook-signatures/useSpaceLibraryData";

/** Collections that may appear in `?collection=`; anything else falls back to Recent. */
export const libraryCollectionKinds = new Set<LibraryCollectionKind>(["recent", "deleted"]);
