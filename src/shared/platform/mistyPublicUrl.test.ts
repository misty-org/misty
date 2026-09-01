import { describe, expect, it } from "vitest";

import { normalizeMistyPublicUrl } from "./mistyPublicUrl";

describe("normalizeMistyPublicUrl", () => {
  it("uses the configured website without a trailing slash", () => {
    expect(normalizeMistyPublicUrl(" https://dev.mistysys.com/ ")).toBe("https://dev.mistysys.com");
  });

  it("falls back when the configured website is unsafe", () => {
    expect(normalizeMistyPublicUrl("javascript:alert(1)")).toBe("https://mistysys.com");
    expect(normalizeMistyPublicUrl("https://user:password@mistysys.com")).toBe(
      "https://mistysys.com",
    );
  });
});
