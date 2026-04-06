import { describe, expect, it } from "vitest";
import { estimateSmartLibraryTokens } from "./smartLibrary";

describe("estimateSmartLibraryTokens", () => {
  it("includes one shared prompt per bounded eight-file batch", () => {
    expect(estimateSmartLibraryTokens(0)).toEqual({
      assetCount: 0,
      batchCount: 0,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      estimatedEmbeddingTokens: 0,
      estimatedTotalTokens: 0,
      estimatedLowTokens: 0,
      estimatedHighTokens: 0,
    });
    const estimate = estimateSmartLibraryTokens(9);
    expect(estimate.batchCount).toBe(2);
    expect(estimate.estimatedInputTokens).toBe(9 * 340 + 2 * 180);
    expect(estimate.estimatedTotalTokens).toBe(
      estimate.estimatedInputTokens +
        estimate.estimatedOutputTokens +
        estimate.estimatedEmbeddingTokens,
    );
  });

  it("normalizes invalid and fractional counts", () => {
    expect(estimateSmartLibraryTokens(-5).assetCount).toBe(0);
    expect(estimateSmartLibraryTokens(2.9).assetCount).toBe(2);
  });
});
