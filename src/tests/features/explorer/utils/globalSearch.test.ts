import { describe, expect, it } from "vitest";
import type {
  ResolvedMediaAsset,
  ResolvedSmartLibraryAsset,
  SearchResult,
} from "@/models/interfaces/services/misty-api";
import type { MediaSearchHit } from "@/models/interfaces/stores/media/useMediaSearchServerStore";
import type { SemanticSearchHit } from "@/models/interfaces/stores/media/useSmartLibraryServerStore";
import {
  isPathWithin,
  mediaHitsToSearchResults,
  mergeHybridSearchResults,
  semanticHitsToSearchResults,
} from "@/features/explorer/utils/globalSearch";

describe("global semantic Explorer search", () => {
  it("resolves opaque semantic IDs to actionable device-only paths", () => {
    const hits: SemanticSearchHit[] = [
      {
        assetId: "opaque_1",
        folderId: "server_folder",
        description: "Pikachu behind a dark file manager",
        tags: ["pikachu", "file manager"],
        suggestedCollections: ["Screenshots"],
        score: 0.93,
        semanticScore: 0.96,
        lexicalScore: 0.42,
        matchReasons: ["character: Pikachu", "application: file manager"],
        metadata: { assetKind: "image", mimeType: "image/png", sizeBytes: 721000 },
      },
    ];
    const locations: ResolvedSmartLibraryAsset[] = [
      {
        assetId: "opaque_1",
        path: "/Users/test/Pictures/pikachu.png",
        relativePath: "pikachu.png",
        name: "pikachu.png",
        sourceKind: "local",
      },
    ];

    const [result] = semanticHitsToSearchResults(hits, locations, { scope: "everything" });

    expect(result.entry.path).toBe("/Users/test/Pictures/pikachu.png");
    expect(result.entry.mimeType).toBe("image/png");
    expect(result.match).toMatchObject({
      kind: "hybrid",
      semanticScore: 0.96,
      tags: ["pikachu", "file manager"],
      assetKind: "image",
    });
  });

  it("shows specific generated entities before generic ranker reasons", () => {
    const hit = semanticHit("asset");
    hit.matchReasons = ["metadata", "semantic"];
    hit.metadata = {
      characters: ["Pikachu"],
      applications: ["file manager"],
      primarySubject: "Pikachu desktop",
    };
    const [result] = semanticHitsToSearchResults(
      [hit],
      [resolved("asset", "/disk/pikachu.png", "local")],
    );
    expect(result.match?.reasons).toEqual(["Pikachu", "file manager", "Pikachu desktop"]);
  });

  it("honors exact current-folder boundaries and source scopes", () => {
    const hit = semanticHit("asset");
    const inFolder = resolved("asset", "/disk/photos/pikachu.png", "local");
    const prefixCollision = resolved("asset", "/disk/photos-old/pikachu.png", "local");
    const remote = resolved("asset", "/mnt/drive/photos/pikachu.png", "cloud");

    expect(
      semanticHitsToSearchResults([hit], [inFolder], {
        scope: "current",
        currentPath: "/disk/photos",
      }),
    ).toHaveLength(1);
    expect(
      semanticHitsToSearchResults([hit], [prefixCollision], {
        scope: "current",
        currentPath: "/disk/photos",
      }),
    ).toHaveLength(0);
    expect(semanticHitsToSearchResults([hit], [remote], { scope: "local" })).toHaveLength(0);
    expect(semanticHitsToSearchResults([hit], [remote], { scope: "remotes" })).toHaveLength(1);
    expect(isPathWithin("C:\\Photos\\one.png", "C:\\Photos")).toBe(true);
  });

  it("deduplicates by path and promotes files found by both indexes", () => {
    const indexed = result("/disk/pikachu.png", 22);
    const semantic = {
      ...result("/disk/pikachu.png", 0.95),
      match: { kind: "semantic" as const, reasons: ["Pikachu"] },
    };
    const semanticOnly = {
      ...result("/disk/other.png", 0.91),
      match: { kind: "semantic" as const, reasons: ["file manager"] },
    };

    const merged = mergeHybridSearchResults([indexed], [semantic, semanticOnly], 10);

    expect(merged).toHaveLength(2);
    expect(merged[0].entry.path).toBe("/disk/pikachu.png");
    expect(merged[0].match).toMatchObject({ kind: "hybrid", reasons: ["Pikachu"] });
  });

  it("turns timestamped spoken and visual moments into separate actionable results", () => {
    const location: ResolvedMediaAsset = {
      assetId: "media_1",
      path: "/Users/test/Movies/movie.mp4",
      name: "movie.mp4",
      mediaType: "video",
      durationMs: 120_000,
    };
    const hits: MediaSearchHit[] = [
      {
        segmentId: "spoken_1",
        assetId: "media_1",
        mediaType: "video",
        kind: "spoken",
        content: "forty eight hours",
        transcript: "forty eight hours",
        visualDescription: "",
        startMs: 180,
        endMs: 1980,
        visibleText: [],
        score: 0.95,
        semanticScore: 0.9,
        lexicalScore: 1,
      },
      {
        segmentId: "visual_1",
        assetId: "media_1",
        mediaType: "video",
        kind: "visual",
        content: "red sports car",
        transcript: "",
        visualDescription: "A red sports car at night",
        startMs: 50_000,
        endMs: 60_000,
        visibleText: [],
        score: 0.9,
        semanticScore: 0.85,
        lexicalScore: 1,
      },
    ];
    const results = mediaHitsToSearchResults(hits, [location]);
    expect(results).toHaveLength(2);
    expect(results[0].match).toMatchObject({
      mediaSegmentId: "spoken_1",
      mediaStartMs: 180,
      mediaMatchKind: "spoken",
    });
    expect(results[1].match).toMatchObject({
      mediaSegmentId: "visual_1",
      mediaStartMs: 50_000,
      mediaMatchKind: "visual",
    });
    expect(mergeHybridSearchResults([], results, 10)).toHaveLength(2);
  });
});

function semanticHit(assetId: string): SemanticSearchHit {
  return {
    assetId,
    description: "match",
    tags: [],
    suggestedCollections: [],
    score: 0.9,
    semanticScore: 0.9,
  };
}

function resolved(
  assetId: string,
  path: string,
  sourceKind: "local" | "cloud",
): ResolvedSmartLibraryAsset {
  return { assetId, path, relativePath: "pikachu.png", name: "pikachu.png", sourceKind };
}

function result(path: string, score: number): SearchResult {
  return {
    entry: {
      id: path,
      name: path.split("/").pop() ?? path,
      path,
      extension: ".png",
      mimeType: "image/png",
      remoteModified: null,
      kind: "file",
      sizeBytes: null,
      modifiedMs: null,
      createdMs: null,
      readonly: false,
      hidden: false,
      location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
    },
    score,
    sourceKind: "local",
    indexedAtMs: 1,
  };
}
