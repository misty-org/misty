import { smartLibraryResolveAssets, smartLibrarySnapshot } from "@/services/backend";
import type {
  ExplorerLocation,
  FileEntry,
  ResolvedMediaAsset,
  ResolvedSmartLibraryAsset,
  SearchResult,
  SearchResultMatch,
  SmartLibraryAsset,
} from "@/services/misty/model/misty-api";
import type { SearchSourceKind } from "@/services/misty/model/types/misty-api";
import type { ExplorerSearchOptions } from "../../model/interfaces/utils/globalSearch";
import type { MediaSearchHit } from "../../model/stores/media/interfaces/useMediaSearchServerStore";
import type { SemanticSearchHit } from "../../model/stores/media/interfaces/useSmartLibraryServerStore";
import {
  baseName,
  extensionOf,
  finiteScore,
  joinPath,
  optionalFiniteNumber,
  pathAllowed,
  stringArray,
  stringValue,
  uniqueStrings,
} from "./searchPaths";

export function mediaHitsToSearchResults(
  hits: MediaSearchHit[],
  locations: ResolvedMediaAsset[],
  options: ExplorerSearchOptions = {},
): SearchResult[] {
  const byId = new Map(locations.map((item) => [item.assetId, item]));
  const now = Date.now();
  return hits.flatMap((hit) => {
    const resolved = byId.get(hit.assetId);
    if (!resolved || !pathAllowed(resolved.path, "local", options)) return [];
    const extension = extensionOf(resolved.name);
    return [
      {
        entry: {
          id: resolved.path,
          name: resolved.name,
          path: resolved.path,
          extension,
          mimeType: hit.mediaType === "video" ? "video/mp4" : "audio/mpeg",
          remoteModified: null,
          kind: "file",
          sizeBytes: null,
          modifiedMs: null,
          createdMs: null,
          readonly: false,
          hidden: false,
          isDeleted: false,
          location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
        },
        score: finiteScore(hit.score, hit.semanticScore),
        sourceKind: "local",
        indexedAtMs: now,
        match: {
          kind: (hit.lexicalScore ?? 0) > 0 ? "hybrid" : "semantic",
          semanticScore: hit.semanticScore,
          lexicalScore: hit.lexicalScore,
          reasons: [
            formatTimestamp(hit.startMs),
            hit.kind === "spoken" ? "Spoken audio" : "Visual scene",
          ],
          description: hit.kind === "spoken" ? hit.transcript : hit.visualDescription,
          tags: hit.visibleText ?? [],
          assetKind: hit.mediaType,
          mediaSegmentId: hit.segmentId,
          mediaType: hit.mediaType,
          mediaStartMs: hit.startMs,
          mediaEndMs: hit.endMs,
          mediaMatchKind: hit.kind,
          transcript: hit.transcript,
          visualDescription: hit.visualDescription,
        },
      } satisfies SearchResult,
    ];
  });
}

export function formatTimestamp(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function mergeMatch(
  current: SearchResultMatch | undefined,
  incoming: SearchResultMatch,
): SearchResultMatch {
  if (!current) return incoming;
  return {
    ...current,
    ...incoming,
    kind: current.kind === incoming.kind ? current.kind : "hybrid",
    reasons: uniqueStrings([...(current.reasons ?? []), ...(incoming.reasons ?? [])]),
    tags: uniqueStrings([...(current.tags ?? []), ...(incoming.tags ?? [])]),
    collections: uniqueStrings([...(current.collections ?? []), ...(incoming.collections ?? [])]),
  };
}

export async function resolveSemanticLocations(
  hits: SemanticSearchHit[],
): Promise<ResolvedSmartLibraryAsset[]> {
  const assetIds = uniqueStrings(hits.map((hit) => hit.assetId)).slice(0, 500);
  try {
    return await smartLibraryResolveAssets(assetIds);
  } catch {
    // Compatibility for desktop builds created before the batched resolver command.
    const library = (await smartLibrarySnapshot()).activeLibrary;
    if (!library) return [];
    const wanted = new Set(assetIds);
    return library.assets
      .filter((asset) => wanted.has(asset.assetId))
      .map((asset) => resolvedFromLegacyAsset(library.rootPath, asset));
  }
}

export function resolvedFromLegacyAsset(
  rootPath: string,
  asset: SmartLibraryAsset,
): ResolvedSmartLibraryAsset {
  return {
    assetId: asset.assetId,
    path: joinPath(rootPath, asset.relativePath),
    relativePath: asset.relativePath,
    name: asset.name,
    sourceKind: asset.sourceKind,
  };
}

export function semanticMatch(
  hit: SemanticSearchHit,
  metadata: Record<string, unknown>,
): SearchResultMatch {
  const inferredReasons = [
    ...stringArray(metadata.characters).slice(0, 2),
    ...stringArray(metadata.applications).slice(0, 2),
    stringValue(metadata.primarySubject),
    ...stringArray(metadata.visibleText).slice(0, 1),
  ].filter((value): value is string => Boolean(value));
  const providerReasons = stringArray(hit.matchReasons).filter(
    (reason) => !genericMatchReasons.has(reason.toLocaleLowerCase()),
  );
  return {
    kind: (hit.lexicalScore ?? 0) > 0 ? "hybrid" : "semantic",
    semanticScore: optionalFiniteNumber(hit.semanticScore),
    lexicalScore: optionalFiniteNumber(hit.lexicalScore),
    reasons: uniqueStrings([...inferredReasons, ...providerReasons]),
    description: typeof hit.description === "string" ? hit.description : null,
    tags: uniqueStrings([
      ...stringArray(hit.tags),
      ...stringArray(metadata.searchTerms),
      ...stringArray(metadata.entities),
      ...stringArray(metadata.characters),
      ...stringArray(metadata.brands),
      ...stringArray(metadata.applications),
      ...stringArray(metadata.objects),
      ...stringArray(metadata.topics),
    ]),
    collections: stringArray(hit.suggestedCollections),
    assetKind: stringValue(hit.assetKind ?? metadata.assetKind ?? metadata.asset_kind),
    extractedText: stringValue(metadata.extractedText ?? metadata.extracted_text),
  };
}

export const genericMatchReasons = new Set(["semantic", "metadata", "hybrid"]);

export function fileEntryFromSemanticLocation(
  resolved: ResolvedSmartLibraryAsset,
  hit: SemanticSearchHit,
  metadata: Record<string, unknown>,
): FileEntry {
  const sourceKind: SearchSourceKind = resolved.sourceKind === "cloud" ? "remote" : "local";
  const location: ExplorerLocation =
    sourceKind === "remote"
      ? {
          kind: "remote",
          providerType: stringValue(metadata.providerType),
          remoteName: stringValue(metadata.remoteName),
          remotePath: resolved.relativePath,
        }
      : { kind: "local", providerType: null, remoteName: null, remotePath: null };
  return {
    id: resolved.path,
    name: resolved.name || baseName(resolved.path),
    path: resolved.path,
    extension: extensionOf(resolved.name),
    mimeType: stringValue(hit.mimeType ?? metadata.mimeType ?? metadata.mime_type),
    remoteModified: null,
    kind: "file",
    sizeBytes: optionalFiniteNumber(metadata.sizeBytes ?? metadata.size_bytes),
    modifiedMs: optionalFiniteNumber(metadata.modifiedMs ?? metadata.modified_ms),
    createdMs: optionalFiniteNumber(metadata.createdMs ?? metadata.created_ms),
    readonly: false,
    hidden: baseName(resolved.path).startsWith("."),
    isDeleted: false,
    location,
  };
}
