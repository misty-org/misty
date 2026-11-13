import { useLibraryBulkActions } from "./library-items/useLibraryBulkActions";
import { useLibraryClipboard } from "./library-items/useLibraryClipboard";
import { useLibraryItemMutations } from "./library-items/useLibraryItemMutations";
import { useLibraryReload } from "./library-items/useLibraryReload";
import { useLibraryUploads } from "./library-items/useLibraryUploads";
import type { SpaceLibraryData } from "./hook-signatures/useSpaceLibraryData";

/**
 * Everything the Library can do to *items*, as opposed to collections.
 *
 * Each concern lives in its own hook under `library-items/`; this file wires
 * them together and flattens the result for the Library surfaces.
 */
export function useSpaceLibraryItemActions(data: SpaceLibraryData) {
  const { reload, loadMore } = useLibraryReload(data);
  const uploads = useLibraryUploads(data, reload);
  const clipboard = useLibraryClipboard(data, reload);
  const mutations = useLibraryItemMutations(data);
  const bulk = useLibraryBulkActions(data, reload);

  return {
    reload,
    loadMore,
    ...uploads,
    ...clipboard,
    ...mutations,
    ...bulk,
  };
}
