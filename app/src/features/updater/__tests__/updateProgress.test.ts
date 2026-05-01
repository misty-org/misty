import { describe, expect, it } from "vitest";

import { applyUpdateProgress, EMPTY_UPDATE_PROGRESS, readableUpdateError } from "../updateProgress";

describe("update progress", () => {
  it("tracks bounded progress from updater events", () => {
    const started = applyUpdateProgress(EMPTY_UPDATE_PROGRESS, {
      event: "Started",
      data: { contentLength: 100 },
    });
    const halfway = applyUpdateProgress(started, {
      event: "Progress",
      data: { chunkLength: 50 },
    });
    const bounded = applyUpdateProgress(halfway, {
      event: "Progress",
      data: { chunkLength: 500 },
    });

    expect(halfway).toEqual({ downloadedBytes: 50, totalBytes: 100, percent: 50 });
    expect(bounded.percent).toBe(100);
  });

  it("supports downloads without a content length", () => {
    const started = applyUpdateProgress(EMPTY_UPDATE_PROGRESS, {
      event: "Started",
      data: {},
    });
    const progressed = applyUpdateProgress(started, {
      event: "Progress",
      data: { chunkLength: 32 },
    });

    expect(progressed).toEqual({ downloadedBytes: 32, totalBytes: null, percent: null });
  });

  it("does not expose raw configuration or network errors", () => {
    expect(readableUpdateError(new Error("pubkey was not configured"))).toContain(
      "development build",
    );
    expect(readableUpdateError(new Error("network connection failed"))).toContain("update service");
    expect(readableUpdateError(new Error("secret internal failure"))).not.toContain("secret");
  });
});
