export { isPathWithin } from "./globalSearch/searchPaths";
export { mediaHitsToSearchResults } from "./globalSearch/resultMapping";
import { mediaHitsToSearchResults } from "./globalSearch/resultMapping";
import type { ExplorerSearchOptions } from "@/models/interfaces/features/explorer/utils/globalSearch";
export type { ExplorerSearchOptions } from "@/models/interfaces/features/explorer/utils/globalSearch";
import {
  mediaSearchResolveAssets,
  mediaSearchSnapshot,
  searchQuery,
  smartLibraryResolveAssets,
  smartLibrarySnapshot,
} from "@/stores/backend";
import type { SearchQueryScope, SearchSourceKind } from "@/models/types/services/misty-api";
import type {
  ExplorerLibrarySnapshot,
  ExplorerLocation,
  FileEntry,
  ResolvedSmartLibraryAsset,
  ResolvedMediaAsset,
  SearchQueryRequest,
  SearchResult,
  SearchResultMatch,
  SmartLibraryAsset,
  SavedSearchRule,
} from "@/models/interfaces/services/misty-api";
import { searchSemanticAssets } from "@/stores/media/useSmartLibraryServerStore";
import type { SemanticSearchHit } from "@/models/interfaces/stores/media/useSmartLibraryServerStore";
import { searchMedia } from "@/stores/media/useMediaSearchServerStore";
import type { MediaSearchHit } from "@/models/interfaces/stores/media/useMediaSearchServerStore";
import { ensureMediaSearchDeviceReady } from "@/stores/media/useMediaSearchMigrationStore";
import { mergeLibrarySearchResults } from "./librarySearch";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { GlobalSpaceLibraryHit } from "@/models/interfaces/features/agents/personal";
import {
  clampLimit,
  extensionOf,
  finiteScore,
  nonWhitespaceLength,
  normalizePath,
  pathAllowed,
  semanticCacheKey,
  uniqueStrings,
} from "./globalSearch/searchPaths";
import {
  fileEntryFromSemanticLocation,
  mergeMatch,
  resolveSemanticLocations,
  semanticMatch,
} from "./globalSearch/resultMapping";

export const semanticQueryMinimumCharacters = 3;
export const semanticSearchDebounceMs = 650;
const semanticCacheTtlMs = 2 * 60 * 1000;
const semanticCacheMaxEntries = 50;
const semanticCache = new Map<string, { expiresAt: number; results: SearchResult[] }>();
const semanticInFlight = new Map<string, Promise<SearchResult[]>>();
let semanticCacheGeneration = 0;

export async function queryIndexedExplorerSearch(
  query: string,
  options: ExplorerSearchOptions,
  library: ExplorerLibrarySnapshot | null,
): Promise<SearchResult[]> {
  const request: SearchQueryRequest = {
    query,
    currentPath: options.currentPath,
    scope: options.scope,
    includeFiles: options.includeFiles ?? true,
    includeDirectories: options.includeDirectories ?? true,
    includeHidden: options.includeHidden ?? false,
    limit: options.limit ?? 100,
    rules: options.rules,
    matchMode: options.matchMode,
  };
  const results = await searchQuery(request);
  return mergeLibrarySearchResults(results, library, query, options);
}

export async function querySemanticExplorerSearch(
  query: string,
  options: ExplorerSearchOptions,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (
    nonWhitespaceLength(trimmed) < semanticQueryMinimumCharacters ||
    options.includeFiles === false
  )
    return [];
  const limit = clampLimit(options.limit ?? 100);
  const cacheKey = semanticCacheKey(trimmed, options, limit);
  const cacheGeneration = semanticCacheGeneration;
  const cached = semanticCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  if (cached) semanticCache.delete(cacheKey);
  const inFlight = semanticInFlight.get(cacheKey);
  if (inFlight) {
    const results = await inFlight;
    return cacheGeneration === semanticCacheGeneration ? results : [];
  }
  let cacheable = false;
  const request = (async () => {
    const [libraryResponse, mediaResponse, spacesResponse] = await Promise.allSettled([
      searchSemanticAssets(trimmed, { limit }),
      mediaSearchSnapshot()
        .then(ensureMediaSearchDeviceReady)
        .then((snapshot) => searchMedia(snapshot.deviceId, trimmed, Math.min(30, limit))),
      spacesApi.globalSpaceLibrarySearch(trimmed, Math.min(50, limit)),
    ]);
    const libraryHits = libraryResponse.status === "fulfilled" ? libraryResponse.value.hits : [];
    const mediaHits = mediaResponse.status === "fulfilled" ? mediaResponse.value.hits : [];
    const spaceHits = spacesResponse.status === "fulfilled" ? spacesResponse.value.hits : [];
    const [locations, mediaLocations] = await Promise.all([
      libraryHits.length ? resolveSemanticLocations(libraryHits) : Promise.resolve([]),
      mediaHits.length ? resolveMediaLocations(mediaHits) : Promise.resolve([]),
    ]);
    cacheable =
      libraryResponse.status === "fulfilled" &&
      mediaResponse.status === "fulfilled" &&
      spacesResponse.status === "fulfilled" &&
      (libraryHits.length === 0 || locations.length > 0) &&
      (mediaHits.length === 0 || mediaLocations.length > 0);
    return [
      ...semanticHitsToSearchResults(libraryHits, locations, options),
      ...mediaHitsToSearchResults(mediaHits, mediaLocations, options),
      ...spaceLibraryHitsToSearchResults(spaceHits),
    ]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  })();
  semanticInFlight.set(cacheKey, request);
  try {
    const results = await request;
    if (cacheGeneration !== semanticCacheGeneration) return [];
    if (cacheable) {
      semanticCache.set(cacheKey, { expiresAt: Date.now() + semanticCacheTtlMs, results });
      while (semanticCache.size > semanticCacheMaxEntries)
        semanticCache.delete(semanticCache.keys().next().value as string);
    }
    return results;
  } finally {
    if (semanticInFlight.get(cacheKey) === request) semanticInFlight.delete(cacheKey);
  }
}

function spaceLibraryHitsToSearchResults(hits: GlobalSpaceLibraryHit[]): SearchResult[] {
  const now = Date.now();
  return hits.map((hit, index) => {
    const filename = hit.item.file.original_filename || hit.item.display_name;
    const extension = extensionOf(filename);
    return {
      entry: {
        id: hit.item.id,
        name: hit.item.display_name,
        path: `/spaces/${hit.space_id}/library/${hit.item.id}`,
        extension,
        mimeType: null,
        remoteModified: hit.item.updated_at,
        kind: "file",
        sizeBytes: null,
        modifiedMs: Date.parse(hit.item.updated_at) || null,
        createdMs: Date.parse(hit.item.added_at) || null,
        readonly: true,
        hidden: false,
        isDeleted: false,
        location: {
          kind: "remote",
          providerType: "misty-space",
          remoteName: hit.space_name,
          remotePath: hit.deep_link,
        },
      },
      score: Math.max(0.1, 1 - index / Math.max(1, hits.length)),
      sourceKind: "remote",
      indexedAtMs: now,
      match: {
        kind: "semantic",
        reasons: [hit.space_name, ...(hit.item.tags ?? []).slice(0, 2)],
        description: hit.item.caption || null,
        tags: hit.item.tags,
        assetKind: "Space Library",
      },
    } satisfies SearchResult;
  });
}

export function clearSemanticExplorerSearchCache(): void {
  semanticCacheGeneration += 1;
  semanticCache.clear();
  semanticInFlight.clear();
}

/**
 * Weighted reciprocal-rank fusion avoids comparing incompatible native-index and
 * vector score scales. Duplicate paths retain semantic evidence for the UI.
 */
export function mergeHybridSearchResults(
  indexedResults: SearchResult[],
  semanticResults: SearchResult[],
  limit = 100,
): SearchResult[] {
  const records = new Map<
    string,
    { result: SearchResult; fused: number; indexed: boolean; semantic: boolean }
  >();
  addRankedResults(records, indexedResults, "indexed");
  addRankedResults(records, semanticResults, "semantic");
  return [...records.values()]
    .map(({ result, fused, indexed, semantic }) => ({
      ...result,
      score: fused + (indexed && semantic ? 0.08 : 0),
      match: indexed && semantic ? mergeMatch(result.match, { kind: "hybrid" }) : result.match,
    }))
    .sort(
      (left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name),
    )
    .slice(0, clampLimit(limit));
}

export function semanticHitsToSearchResults(
  hits: SemanticSearchHit[],
  locations: ResolvedSmartLibraryAsset[],
  options: ExplorerSearchOptions = {},
): SearchResult[] {
  const byAssetId = new Map(locations.map((location) => [location.assetId, location]));
  const now = Date.now();
  return hits.flatMap((hit) => {
    const resolved = byAssetId.get(hit.assetId);
    if (!resolved || !pathAllowed(resolved.path, resolved.sourceKind, options)) return [];
    const metadata = hit.metadata ?? {};
    const match = semanticMatch(hit, metadata);
    return [
      {
        entry: fileEntryFromSemanticLocation(resolved, hit, metadata),
        score: finiteScore(hit.score, hit.semanticScore),
        sourceKind: resolved.sourceKind === "cloud" ? "remote" : "local",
        indexedAtMs: now,
        match,
      } satisfies SearchResult,
    ];
  });
}

function addRankedResults(
  records: Map<
    string,
    { result: SearchResult; fused: number; indexed: boolean; semantic: boolean }
  >,
  results: SearchResult[],
  source: "indexed" | "semantic",
): void {
  results.forEach((candidate, index) => {
    const key = candidate.match?.mediaSegmentId
      ? `${normalizePath(candidate.entry.path)}#${candidate.match.mediaSegmentId}`
      : normalizePath(candidate.entry.path);
    const contribution = (source === "semantic" ? 1.08 : 1) / (12 + index + 1);
    const existing = records.get(key);
    if (!existing) {
      records.set(key, {
        result: candidate,
        fused: contribution,
        indexed: source === "indexed",
        semantic: source === "semantic",
      });
      return;
    }
    existing.fused += contribution;
    existing.indexed ||= source === "indexed";
    existing.semantic ||= source === "semantic";
    if (candidate.match)
      existing.result = {
        ...existing.result,
        match: mergeMatch(existing.result.match, candidate.match),
      };
  });
}

async function resolveMediaLocations(hits: MediaSearchHit[]): Promise<ResolvedMediaAsset[]> {
  try {
    return await mediaSearchResolveAssets(
      uniqueStrings(hits.map((hit) => hit.assetId)).slice(0, 100),
    );
  } catch {
    return [];
  }
}
