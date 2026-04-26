import type { SmartLibraryAsset } from "@/models/interfaces/services/misty-api";

export const DEFAULT_LIBRARY_TAG_LIMIT = 12;
export const DEFAULT_ASSET_TAG_LIMIT = 5;

export function aggregateLibraryTags(assets: SmartLibraryAsset[]): LibraryTagCount[] {
  const counts = new Map<string, LibraryTagCount>();
  for (const asset of assets) {
    const assetTags = new Map(asset.tags.map((tag) => [tag.toLocaleLowerCase(), tag]));
    for (const [key, tag] of assetTags) {
      const current = counts.get(key);
      counts.set(key, { name: current?.name ?? tag, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name),
  );
}

export function visibleLibraryTags(
  tags: LibraryTagCount[],
  options: { query: string; expanded: boolean; selectedTag: string | null },
): LibraryTagCount[] {
  const query = options.query.trim().toLocaleLowerCase();
  if (query) return tags.filter((tag) => tag.name.toLocaleLowerCase().includes(query));
  if (options.expanded || tags.length <= DEFAULT_LIBRARY_TAG_LIMIT) return tags;
  const visible = tags.slice(0, DEFAULT_LIBRARY_TAG_LIMIT);
  const selected = options.selectedTag
    ? tags.find((tag) => tag.name.toLocaleLowerCase() === options.selectedTag?.toLocaleLowerCase())
    : null;
  return selected && !visible.includes(selected) ? [...visible, selected] : visible;
}

export function visibleAssetTags(tags: string[], expanded: boolean): string[] {
  return expanded ? tags : tags.slice(0, DEFAULT_ASSET_TAG_LIMIT);
}

export function tagsWithout(tags: string[], removedTag: string): string[] {
  const removed = removedTag.toLocaleLowerCase();
  return tags.filter((tag) => tag.toLocaleLowerCase() !== removed);
}

export interface LibraryTagCount {
  name: string;
  count: number;
}
