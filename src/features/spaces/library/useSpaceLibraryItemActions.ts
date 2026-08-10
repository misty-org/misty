export type { SpaceLibraryItemActions } from "./types/useSpaceLibraryItemActions";

import { useLibraryAssetStacks } from "./libraryItems/useLibraryAssetStacks";
import { useLibraryBulkActions } from "./libraryItems/useLibraryBulkActions";
import { useLibraryClipboard } from "./libraryItems/useLibraryClipboard";
import { useLibraryItemMutations } from "./libraryItems/useLibraryItemMutations";
import { useLibraryReload } from "./libraryItems/useLibraryReload";
import { useLibraryUnlock } from "./libraryItems/useLibraryUnlock";
import { useLibraryUploads } from "./libraryItems/useLibraryUploads";
import type { SpaceLibraryData } from "./types/useSpaceLibraryData";

/**
 * Everything the Library can do to *items*, as opposed to collections.
 *
 * Each concern lives in its own hook under `libraryItems/`; this file wires
 * them together and flattens the result for the Library surfaces.
 */
export function useSpaceLibraryItemActions(data: SpaceLibraryData) {
  const { reload, loadMore } = useLibraryReload(data);
  const uploads = useLibraryUploads(data, reload);
  const stacks = useLibraryAssetStacks(data, reload);
  const clipboard = useLibraryClipboard(data, reload);
  const mutations = useLibraryItemMutations(data);
  const bulk = useLibraryBulkActions(data, reload);
  const unlock = useLibraryUnlock(data);

  return {
    reload,
    loadMore,
    ...uploads,
    ...stacks,
    ...clipboard,
    ...mutations,
    ...bulk,
    ...unlock,
  };
}
