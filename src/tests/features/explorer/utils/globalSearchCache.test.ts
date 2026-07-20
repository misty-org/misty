import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchSemanticAssets: vi.fn(),
  searchMedia: vi.fn(),
  mediaSearchResolveAssets: vi.fn(),
  mediaSearchSnapshot: vi.fn(),
}));

vi.mock("@/stores/media/useSmartLibraryServerStore", () => ({
  searchSemanticAssets: mocks.searchSemanticAssets,
}));
vi.mock("@/stores/media/useMediaSearchServerStore", () => ({
  searchMedia: mocks.searchMedia,
}));
vi.mock("@/stores/backend", () => ({
  mediaSearchResolveAssets: mocks.mediaSearchResolveAssets,
  mediaSearchSnapshot: mocks.mediaSearchSnapshot,
  searchQuery: vi.fn(),
  smartLibraryResolveAssets: vi.fn().mockResolvedValue([]),
  smartLibrarySnapshot: vi.fn().mockResolvedValue({ activeLibrary: null }),
}));

import {
  clearSemanticExplorerSearchCache,
  querySemanticExplorerSearch,
} from "@/features/explorer/utils/globalSearch";

describe("global media search cache resilience", () => {
  beforeEach(() => {
    clearSemanticExplorerSearchCache();
    vi.clearAllMocks();
    mocks.searchSemanticAssets.mockResolvedValue({ hits: [] });
    mocks.mediaSearchResolveAssets.mockResolvedValue([
      {
        assetId: "media_0123456789abcdef0123456789abcdef",
        path: "/Users/test/Movies/movie.mp4",
        name: "movie.mp4",
        mediaType: "video",
        durationMs: 120_000,
      },
    ]);
    mocks.mediaSearchSnapshot.mockResolvedValue({
      deviceId: "device_0123456789abcdef0123456789abcdef",
    });
  });

  it("does not cache a silent fallback when the media branch is temporarily unavailable", async () => {
    mocks.searchMedia.mockRejectedValueOnce(new Error("server restarting")).mockResolvedValueOnce({
      hits: [
        {
          segmentId: "segment_1",
          assetId: "media_0123456789abcdef0123456789abcdef",
          mediaType: "video",
          kind: "visual",
          content: "red luxury SUV",
          transcript: "",
          visualDescription: "A red luxury SUV at night",
          startMs: 40_000,
          endMs: 50_000,
          visibleText: [],
          score: 0.92,
          semanticScore: 0.9,
          lexicalScore: 1,
        },
      ],
    });

    expect(await querySemanticExplorerSearch("red luxury SUV", {})).toEqual([]);
    const retried = await querySemanticExplorerSearch("red luxury SUV", {});

    expect(mocks.searchMedia).toHaveBeenCalledTimes(2);
    expect(retried[0]?.match?.mediaStartMs).toBe(40_000);
  });
});
