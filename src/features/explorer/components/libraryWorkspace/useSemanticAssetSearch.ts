import { useEffect, useState } from "react";
import { searchSemanticAssets } from "@/stores/media/useSmartLibraryServerStore";

const DEBOUNCE_MS = 320;
const MIN_QUERY_CHARACTERS = 3;
const RESULT_LIMIT = 100;

/**
 * Debounced semantic search over the Library's analyzed assets.
 *
 * Short queries are handled by the local substring filter alone, so the
 * embedding request only fires once there is enough to be meaningful. Results
 * are ids, in rank order — the caller decides how to merge them.
 */
export function useSemanticAssetSearch(query: string, folderId: string | undefined) {
  const [semanticAssetIds, setSemanticAssetIds] = useState<string[] | null>(null);
  const [semanticSearching, setSemanticSearching] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);

  useEffect(() => {
    const needle = query.trim();
    if (!folderId || needle.replace(/\s/g, "").length < MIN_QUERY_CHARACTERS) {
      setSemanticAssetIds(null);
      setSemanticSearching(false);
      setSemanticError(null);
      return;
    }
    let canceled = false;
    setSemanticSearching(true);
    setSemanticError(null);
    const timer = window.setTimeout(() => {
      void searchSemanticAssets(needle, { folderId, limit: RESULT_LIMIT })
        .then((response) => {
          if (canceled) return;
          setSemanticAssetIds(response.hits.map((hit) => hit.assetId));
          setSemanticSearching(false);
        })
        .catch((reason: unknown) => {
          if (canceled) return;
          setSemanticAssetIds(null);
          setSemanticSearching(false);
          setSemanticError(reason instanceof Error ? reason.message : String(reason));
        });
    }, DEBOUNCE_MS);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [folderId, query]);

  return { semanticAssetIds, semanticSearching, semanticError };
}
