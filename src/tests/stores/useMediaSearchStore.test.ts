import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@/models/interfaces/services/misty-api";
import { estimateAssets } from "@/stores/media/useMediaSearchStore";

describe("media indexing estimates", () => {
  it("estimates weekly hosted AI impact", () => {
    const estimate = estimateAssets([asset({ durationMs: 120_186 })]);
    expect(estimate.remainingDurationMs).toBe(120_186);
    expect(estimate.estimatedWeeklyPercent).toBe(21);
  });

  it("charges only resumable work remaining after persisted chunks", () => {
    const estimate = estimateAssets([
      asset({
        durationMs: 120_186,
        approvedFingerprint: "a".repeat(64),
        nextChunkIndex: 3,
      }),
    ]);
    expect(estimate.remainingDurationMs).toBe(30_186);
    expect(estimate.estimatedWeeklyPercent).toBe(6);
  });
});

function asset(overrides: Partial<MediaAsset>): MediaAsset {
  const fingerprint = "a".repeat(64);
  return {
    assetId: "media_0123456789abcdef0123456789abcdef",
    path: "/Users/test/Movies/media.mp4",
    name: "media.mp4",
    fingerprint,
    mediaType: "video",
    mimeType: "video/mp4",
    durationMs: 60_000,
    sizeBytes: 1,
    modifiedMs: 1,
    status: "pending",
    indexedFingerprint: null,
    approvedFingerprint: null,
    nextChunkIndex: 0,
    failureCode: null,
    ...overrides,
  };
}
