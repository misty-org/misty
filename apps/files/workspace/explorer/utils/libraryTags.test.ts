import type { SmartLibraryAsset } from "@/native/contracts";
import { describe, expect, it } from "vitest";
import {
  aggregateLibraryTags,
  DEFAULT_ASSET_TAG_LIMIT,
  DEFAULT_LIBRARY_TAG_LIMIT,
  tagsWithout,
  visibleAssetTags,
  visibleLibraryTags,
} from "../utils/libraryTags";

function asset(assetId: string, tags: string[]): SmartLibraryAsset {
  return {
    assetId,
    relativePath: `${assetId}.png`,
    name: `${assetId}.png`,
    mimeType: "image/png",
    extension: "png",
    sizeBytes: 1,
    modifiedMs: 1,
    fingerprint: assetId,
    sourceKind: "local",
    previewSupported: true,
    unsupportedReason: null,
    status: "analyzed",
    description: null,
    tags,
    collections: [],
    confidence: null,
    failure: null,
  };
}

describe("library tag disclosure", () => {
  it("ranks aggregate tags and shows twelve by default", () => {
    const tags = aggregateLibraryTags([
      asset("one", ["popular", ...Array.from({ length: 13 }, (_, index) => `tag-${index}`)]),
      asset("two", ["POPULAR"]),
    ]);
    const visible = visibleLibraryTags(tags, { query: "", expanded: false, selectedTag: null });
    expect(visible).toHaveLength(DEFAULT_LIBRARY_TAG_LIMIT);
    expect(visible[0]).toEqual({ name: "popular", count: 2 });
  });

  it("searches hidden tags case-insensitively and keeps an active hidden tag visible", () => {
    const tags = Array.from({ length: 14 }, (_, index) => ({
      name: `Tag ${index}`,
      count: 14 - index,
    }));
    expect(
      visibleLibraryTags(tags, { query: "TAG 13", expanded: false, selectedTag: null }).map(
        (tag) => tag.name,
      ),
    ).toEqual(["Tag 13"]);
    expect(
      visibleLibraryTags(tags, { query: "", expanded: false, selectedTag: "Tag 13" }).slice(-1)[0]
        ?.name,
    ).toBe("Tag 13");
  });

  it("shows five file tags until expanded and removes only the confirmed value", () => {
    const tags = ["one", "two", "three", "four", "five", "six"];
    expect(visibleAssetTags(tags, false)).toHaveLength(DEFAULT_ASSET_TAG_LIMIT);
    expect(visibleAssetTags(tags, true)).toEqual(tags);
    expect(tagsWithout(tags, "THREE")).toEqual(["one", "two", "four", "five", "six"]);
  });
});
