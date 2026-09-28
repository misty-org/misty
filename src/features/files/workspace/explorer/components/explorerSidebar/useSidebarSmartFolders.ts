import { savedSearchesDelete, savedSearchesSave, savedSearchesSnapshot } from "../../../native";
import { useSearchStore } from "../../../search";
import { createSidebarSmartFolders } from "./createSidebarSmartFolders";
export const useSidebarSmartFolders = createSidebarSmartFolders({
  snapshot: savedSearchesSnapshot,
  save: savedSearchesSave,
  delete: savedSearchesDelete,
  async openSearch(path, query) {
    const searchStore = useSearchStore.getState();
    await searchStore.openSearch(path);
    searchStore.setScope("everything");
    searchStore.setQuery(query);
  },
});
