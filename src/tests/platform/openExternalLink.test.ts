import { describe, expect, it } from "vitest";

import { normalizeExternalUrl } from "@/platform/openExternalLink";

describe("normalizeExternalUrl", () => {
  it.each([
    "https://mistysys.com/support",
    "http://127.0.0.1:8080/callback",
    "mailto:support@mistysys.com",
  ])("accepts an intended external destination: %s", (url) => {
    expect(normalizeExternalUrl(`  ${url}  `)).toBe(url);
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://user:password@example.com",
    "not a url",
  ])("rejects an unsafe external destination: %s", (url) => {
    expect(() => normalizeExternalUrl(url)).toThrow();
  });
});
