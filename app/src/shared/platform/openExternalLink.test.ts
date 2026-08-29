import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureProviderAuthorizationLinkOpener,
  normalizeExternalUrl,
  openProviderAuthorizationLink,
} from "@/shared/platform/openExternalLink";

afterEach(() => configureProviderAuthorizationLinkOpener(null));

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

describe("openProviderAuthorizationLink", () => {
  it("opens desktop authorization in Misty Browser when it is available", async () => {
    const openInMisty = vi.fn();
    configureProviderAuthorizationLinkOpener(openInMisty);

    const result = await openProviderAuthorizationLink("https://accounts.example.com/authorize");

    expect(openInMisty).toHaveBeenCalledWith("https://accounts.example.com/authorize");
    expect(result.strategy).toBe("misty-browser");
  });
});
