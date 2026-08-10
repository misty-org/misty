import { spacesApi } from "@/services/spaces/api";
import type { LibrarySearchFacets } from "@/services/spaces/dto/interfaces/types";
import { useEffect, useState } from "react";
import { libraryFacetPrefix } from "../libraryFormat";

const QUERY_DEBOUNCE_MS = 250;
const FACET_DEBOUNCE_MS = 150;

const emptyFacets: LibrarySearchFacets = {
  total: 0,
  favorites: 0,
  hidden: 0,
  recently_deleted: 0,
  tags: [],
  media_types: [],
  years: [],
  albums: [],
  utilities: [],
};

/**
 * The Library search box and its facet counts.
 *
 * The committed query lags the input by a debounce so typing does not refetch
 * items on every keystroke; facets are fetched on a shorter delay because they
 * drive the suggestion list under the cursor.
 */
export function useLibrarySearch(spaceId: string) {
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFacets, setSearchFacets] = useState<LibrarySearchFacets>(emptyFacets);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void spacesApi
        .libraryFacets(spaceId, libraryFacetPrefix(searchInput))
        .then((facets) => current && setSearchFacets(facets))
        .catch(() => current && setSearchFacets(emptyFacets));
    }, FACET_DEBOUNCE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [searchInput, spaceId]);

  return {
    searchInput,
    setSearchInput,
    searchQuery,
    setSearchQuery,
    searchFocused,
    setSearchFocused,
    searchFacets,
  };
}
