import { describe, expect, it } from "vitest";
import { formatTokens } from "./format";

describe("token counts", () => {
  it("formats tokens without printing 1000 of a unit", () => {
    expect(formatTokens(314)).toBe("314");
    expect(formatTokens(96_000)).toBe("96k");
    expect(formatTokens(482_800)).toBe("482.8k");
    expect(formatTokens(999_999)).toBe("1M");
    expect(formatTokens(1_111_253_443)).toBe("1.1B");
  });
});
