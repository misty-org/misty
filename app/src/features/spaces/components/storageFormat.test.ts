import { describe, expect, it } from "vitest";
import { formatStorageBytes } from "../components/spacePanel/storageFormat";

describe("formatStorageBytes", () => {
  it("formats storage in the decimal units the plan quotas are defined in", () => {
    // The Basic pool is exactly 2,000,000,000 bytes and has to read as "2 GB",
    // not the 1.86 GB a 1024 divisor produced.
    expect(formatStorageBytes(2000000000)).toBe("2 GB");
    expect(formatStorageBytes(50000000000)).toBe("50 GB");
    expect(formatStorageBytes(1000)).toBe("1 KB");
    expect(formatStorageBytes(1500000)).toBe("1.5 MB");
    expect(formatStorageBytes(0)).toBe("0 B");
  });

  it("never shows more than one decimal place", () => {
    for (const bytes of [2500000, 1073741824, 1572864, 123456789, 999999999999]) {
      expect(formatStorageBytes(bytes)).toMatch(/^\d+(\.\d)? (B|KB|MB|GB|TB)$/);
    }
  });
});
