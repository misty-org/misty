// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportPerformanceReport } from "./export";
import type { PerformanceReport } from "./summary";

const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn() }));
vi.mock("./nativeApi", () => ({
  performanceApi: { pickSavePath: mocks.save, writeFile: mocks.write },
}));
beforeEach(() => {
  mocks.save.mockReset();
  mocks.write.mockReset();
});
const report = {
  generatedAt: "2026-09-23T00:00:00.000Z",
  native: { samples: [1, 2, 3] },
} as unknown as PerformanceReport;

describe("full diagnostic file export", () => {
  it("writes full compact JSON only to the selected path", async () => {
    mocks.save.mockResolvedValue("/chosen/report.json");
    await expect(exportPerformanceReport(report)).resolves.toBe("saved");
    expect(mocks.save).toHaveBeenCalledWith("misty-performance-2026-09-23T00-00-00-000Z.json");
    expect(mocks.write).toHaveBeenCalledWith("/chosen/report.json", JSON.stringify(report));
  });
  it("does not write or claim success on cancellation", async () => {
    mocks.save.mockResolvedValue(null);
    await expect(exportPerformanceReport(report)).resolves.toBe("cancelled");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("propagates write failure", async () => {
    mocks.save.mockResolvedValue("/chosen/report.json");
    mocks.write.mockRejectedValue(new Error("disk unavailable"));
    await expect(exportPerformanceReport(report)).rejects.toThrow("disk unavailable");
  });
});
