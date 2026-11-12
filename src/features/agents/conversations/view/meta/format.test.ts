import { describe, expect, it } from "vitest";
import { formatDuration, formatTokens, formatUsage, modelDisplayName } from "./format";

describe("run meta formats", () => {
  it("formats durations", () => {
    expect(formatDuration(12_340)).toBe("12.3s");
    expect(formatDuration(132_000)).toBe("2m12s");
    expect(formatDuration(4_980_000)).toBe("1h23m");
    expect(formatDuration(0)).toBeNull();
  });

  it("formats tokens without printing 1000 of a unit", () => {
    expect(formatTokens(314)).toBe("314");
    expect(formatTokens(96_000)).toBe("96k");
    expect(formatTokens(482_800)).toBe("482.8k");
    expect(formatTokens(999_999)).toBe("1M");
    expect(formatTokens(1_111_253_443)).toBe("1.1B");
  });

  it("counts cache as input and drops empty reports", () => {
    expect(formatUsage({ input: 200, cacheRead: 3000, output: 412 })).toBe("↑3.2k ↓412");
    expect(formatUsage({})).toBeNull();
  });

  it("names the model without its relay prefix", () => {
    expect(modelDisplayName("relay vendor/deepseek-v4")).toBe("deepseek-v4");
    expect(modelDisplayName("claude-opus-4")).toBe("claude-opus-4");
  });
});
