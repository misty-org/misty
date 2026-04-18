import { useEffect, useMemo, useState } from "react";
import type { SmartLibraryAsset } from "@/models/interfaces/services/misty-api";
import { aggregateLibraryTags, visibleLibraryTags } from "../../utils/libraryTags";

/**
 * Text and tag filtering over the Library's analyzed assets.
 *
 * Semantic hits are folded into the same list: an asset qualifies on either a
 * local substring match or a semantic hit, and semantic rank wins the sort so
 * meaning-based results surface above alphabetical ones.
 */
export function useLibraryAssetFilter(options: {
  analyzed: SmartLibraryAsset[];
  /** Owned by the caller, because the semantic search that feeds this hook needs it first. */
  query: string;
  semanticAssetIds: string[] | null;
}) {
  const { analyzed, query, semanticAssetIds } = options;
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagQuery, setTagQuery] = useState("");
  const [tagsExpanded, setTagsExpanded] = useState(false);

  const tags = useMemo(() => aggregateLibraryTags(analyzed), [analyzed]);
  const visibleTags = useMemo(
    () => visibleLibraryTags(tags, { query: tagQuery, expanded: tagsExpanded, selectedTag }),
    [selectedTag, tagQuery, tags, tagsExpanded],
  );

  // A tag can disappear when its last asset is removed or re-analyzed.
  useEffect(() => {
    if (
      selectedTag &&
      !tags.some((tag) => tag.name.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())
    )
      setSelectedTag(null);
  }, [selectedTag, tags]);

  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const semanticRank = new Map(
      (semanticAssetIds ?? []).map((assetId, index) => [assetId, index]),
    );
    return analyzed
      .filter((asset) => {
        if (
          selectedTag &&
          !asset.tags.some((tag) => tag.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())
        )
          return false;
        if (!needle) return true;
        const localMatch = [asset.name, asset.description, ...asset.tags, ...asset.collections]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(needle));
        return localMatch || semanticRank.has(asset.assetId);
      })
      .sort((left, right) => {
        const leftRank = semanticRank.get(left.assetId);
        const rightRank = semanticRank.get(right.assetId);
        if (leftRank !== undefined || rightRank !== undefined)
          return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
        return left.name.localeCompare(right.name);
      });
  }, [analyzed, query, selectedTag, semanticAssetIds]);

  return {
    selectedTag,
    setSelectedTag,
    tagQuery,
    setTagQuery,
    tagsExpanded,
    setTagsExpanded,
    tags,
    visibleTags,
    visibleAssets,
  };
}
