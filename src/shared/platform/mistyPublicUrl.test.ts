import { describe, expect, it } from "vitest";

import { normalizeMistyPublicUrl } from "./mistyPublicUrl";

describe("normalizeMistyPublicUrl", () => {
  it("uses the configured website without a trailing slash", () => {
    expect(normalizeMistyPublicUrl(" https://misty.example/ ")).toBe("https://misty.example");
  });

  it("has no website when none is configured or the configured one is unsafe", () => {
    expect(normalizeMistyPublicUrl(undefined)).toBe("");
    expect(normalizeMistyPublicUrl("javascript:alert(1)")).toBe("");
    expect(normalizeMistyPublicUrl("https://user:password@misty.example")).toBe("");
  });

  it("respects custom fallback when provided", () => {
    expect(normalizeMistyPublicUrl(undefined, "http://localhost:5174")).toBe(
      "http://localhost:5174",
    );
    expect(normalizeMistyPublicUrl("javascript:alert(1)", "http://localhost:5174")).toBe(
      "http://localhost:5174",
    );
  });
});
