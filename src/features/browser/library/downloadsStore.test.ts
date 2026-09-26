import { describe, expect, it } from "vitest";
import { downloadProgressFraction, formatBytes } from "./downloadsStore";
import type { BrowserDownloadEntry } from "./native";
const entry = (received: number, total: number) =>
  ({
    received,
    total,
  }) as unknown as BrowserDownloadEntry;
describe("download presentation", () => {
  it("formats sizes compactly", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
  it("reports progress only when the size is known", () => {
    expect(downloadProgressFraction(entry(50, 200))).toBe(0.25);
    expect(downloadProgressFraction(entry(50, -1))).toBeNull();
    expect(downloadProgressFraction(entry(300, 200))).toBe(1);
  });
});
