import { useEffect, useState } from "react";
import { savedSearchesDelete, savedSearchesSave, savedSearchesSnapshot } from "@/stores/backend";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
} from "../../utils/globalSearch";
import {
  smartFolderId,
  smartFolderMatchMode,
  smartFolderQueryFromRules,
  smartFolderRulesWithMode,
  sortSavedSearches,
} from "../ExplorerSidebarSupport";
import type { SavedSearch, SearchResult } from "@/models/interfaces/services/misty-api";
import type { SmartFolderDialogState } from "@/models/types/features/explorer/components/ExplorerSidebarSupport";
import type { SmartFolderDraft } from "@/models/interfaces/features/explorer/components/ExplorerSidebarSupport";
import { matchesRules, searchableRuleText, semanticRuleText } from "./savedSearchRules";

const FOLDER_RESULT_LIMIT = 200;
const SEMANTIC_LIMIT = 100;

/**
 * Saved searches ("smart folders") and the dialog that edits them.
 *
 * Running one is a hybrid query: the indexed search does the broad pass, an
 * optional semantic pass adds meaning-based hits, and the rule set filters the
 * merged list — rules the backend cannot express are applied here.
 */
export function useSmartFolders() {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [folderDialog, setFolderDialog] = useState<SmartFolderDialogState>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderResults, setFolderResults] = useState<SearchResult[]>([]);
  const [folderSearching, setFolderSearching] = useState(false);

  useEffect(() => {
    void savedSearchesSnapshot()
      .then((snapshot) => setSavedSearches(sortSavedSearches(snapshot.searches)))
      .catch(() => undefined);
  }, []);

  const failWith = (reason: unknown) =>
    setFolderError(reason instanceof Error ? reason.message : String(reason));

  const saveFolder = async (draft: SmartFolderDraft) => {
    const search: SavedSearch = {
      id: draft.id || smartFolderId(),
      name: draft.name.trim(),
      query: draft.query.trim() || smartFolderQueryFromRules(draft.rules, draft.matchMode),
      rules: smartFolderRulesWithMode(draft.rules, draft.matchMode),
      updatedAtMs: Date.now(),
    };
    if (!search.name) return;
    try {
      const snapshot = await savedSearchesSave(search);
      setSavedSearches(sortSavedSearches(snapshot.searches));
      setFolderDialog(null);
      setFolderError(null);
    } catch (reason) {
      failWith(reason);
    }
  };

  const deleteFolder = async (id: string) => {
    try {
      const snapshot = await savedSearchesDelete(id);
      setSavedSearches(sortSavedSearches(snapshot.searches));
      setFolderDialog(null);
    } catch (reason) {
      failWith(reason);
    }
  };

  const runFolder = async (search: SavedSearch) => {
    setFolderSearching(true);
    setFolderError(null);
    try {
      const rules = search.rules.filter((rule) => rule.field !== "__match");
      const mode = smartFolderMatchMode(search.rules);
      const textQuery = searchableRuleText(search.query, rules, mode);
      const indexed = await queryIndexedExplorerSearch(
        textQuery,
        { scope: "everything", limit: FOLDER_RESULT_LIMIT, rules, matchMode: mode },
        null,
      );
      const semanticQuery = semanticRuleText(textQuery, rules);
      const semantic = semanticQuery
        ? await querySemanticExplorerSearch(semanticQuery, {
            scope: "everything",
            limit: SEMANTIC_LIMIT,
          })
        : [];
      setFolderResults(
        mergeHybridSearchResults(indexed, semantic, FOLDER_RESULT_LIMIT).filter((result) =>
          matchesRules(result, rules, mode),
        ),
      );
    } catch (reason) {
      failWith(reason);
      setFolderResults([]);
    } finally {
      setFolderSearching(false);
    }
  };

  return {
    savedSearches,
    folderDialog,
    setFolderDialog,
    folderError,
    setFolderError,
    folderResults,
    folderSearching,
    saveFolder,
    deleteFolder,
    runFolder,
  };
}
