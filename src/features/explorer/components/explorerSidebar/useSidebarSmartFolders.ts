import { useEffect, useState } from "react";
import { errorText } from "@/lib/format";
import { savedSearchesSnapshot } from "@/stores/backend";
import type { SavedSearch } from "@/models/interfaces/services/misty-api";
import type { SmartFolderDialogState } from "@/models/types/features/explorer/components/ExplorerSidebarSupport";
import { savedSearchesDelete, savedSearchesSave } from "@/stores/backend";
import { useSearchStore } from "@/stores/explorer";
import type { SmartFolderDraft } from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";
import type { ExplorerSidebarProps } from "@/models/interfaces/features/explorer/components/ExplorerSidebar";
import {
  createSmartFolderDialogState,
  smartFolderId,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  smartFolderRulesWithMode,
  sortSavedSearches,
} from "../ExplorerSidebarSupport";

/** The sidebar's saved-search list and the dialog that edits it. */
export function useSidebarSmartFolders(sidebar: ExplorerSidebarProps) {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [smartFolderDialog, setSmartFolderDialog] = useState<SmartFolderDialogState>(null);
  const [smartFolderError, setSmartFolderError] = useState<string | null>(null);
  const [smartFoldersLoading, setSmartFoldersLoading] = useState(false);

  useEffect(() => {
    let disposed = false;
    setSmartFoldersLoading(true);
    void savedSearchesSnapshot()
      .then((snapshot) => {
        if (disposed) return;
        setSavedSearches(sortSavedSearches(snapshot.searches));
        setSmartFolderError(null);
      })
      .catch((error) => {
        if (!disposed) setSmartFolderError(errorText(error));
      })
      .finally(() => {
        if (!disposed) setSmartFoldersLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const openSmartFolderDialog = (search?: SavedSearch) => {
    setSmartFolderError(null);
    setSmartFolderDialog(createSmartFolderDialogState(search));
  };

  const saveSmartFolder = async (draft: SmartFolderDraft) => {
    const name = draft.name.trim();
    if (!name) return;
    const search: SavedSearch = {
      id: draft.id || smartFolderId(),
      name,
      query: draft.query.trim() || smartFolderQueryFromRules(draft.rules, draft.matchMode),
      rules: smartFolderRulesWithMode(draft.rules, draft.matchMode),
      updatedAtMs: Date.now(),
    };
    try {
      const snapshot = await savedSearchesSave(search);
      setSavedSearches(sortSavedSearches(snapshot.searches));
      setSmartFolderDialog(null);
      setSmartFolderError(null);
    } catch (error) {
      setSmartFolderError(errorText(error));
    }
  };

  const deleteSmartFolder = async (id: string) => {
    try {
      const snapshot = await savedSearchesDelete(id);
      setSavedSearches(sortSavedSearches(snapshot.searches));
      setSmartFolderDialog(null);
      setSmartFolderError(null);
    } catch (error) {
      setSmartFolderError(errorText(error));
    }
  };

  const runSmartFolder = async (search: SavedSearch) => {
    const query =
      search.query.trim() ||
      smartFolderQueryFromRules(search.rules, smartFolderMatchMode(search.rules));
    if (!query) return;
    const searchStore = useSearchStore.getState();
    await searchStore.openSearch(sidebar.activePath || sidebar.homePath);
    searchStore.setScope("everything");
    searchStore.setQuery(query);
  };

  return {
    savedSearches,
    setSavedSearches,
    smartFolderDialog,
    setSmartFolderDialog,
    smartFolderError,
    setSmartFolderError,
    smartFoldersLoading,
    openSmartFolderDialog,
    saveSmartFolder,
    deleteSmartFolder,
    runSmartFolder,
  };
}
