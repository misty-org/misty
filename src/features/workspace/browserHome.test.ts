import { afterEach, describe, expect, it } from "vitest";
import {
  browserHomeUrl,
  configureBrowserHomeUrl,
  defaultBrowserHomeUrl,
  normalizeBrowserHomeUrl,
} from "./browserHome";
import { blankBrowserUrl } from "./browserUrl";
import { createBrowserTabState, parseBrowserTabState } from "./model";

afterEach(() => configureBrowserHomeUrl(""));

describe("browser homepage", () => {
  it("defaults to Google when nothing is configured", () => {
    expect(browserHomeUrl()).toBe(defaultBrowserHomeUrl);
    expect(createBrowserTabState().url).toBe(defaultBrowserHomeUrl);
  });

  it("completes a bare host to HTTPS", () => {
    expect(normalizeBrowserHomeUrl("example.com")).toBe("https://example.com/");
    expect(normalizeBrowserHomeUrl("  duckduckgo.com/?q=misty  ")).toBe(
      "https://duckduckgo.com/?q=misty",
    );
  });

  it("keeps an explicit http or https address", () => {
    expect(normalizeBrowserHomeUrl("http://localhost:3000/")).toBe("http://localhost:3000/");
    expect(normalizeBrowserHomeUrl("https://example.com/start")).toBe("https://example.com/start");
  });

  it("honours a deliberately blank homepage", () => {
    expect(normalizeBrowserHomeUrl(blankBrowserUrl)).toBe(blankBrowserUrl);
  });

  it("falls back to the default for empty or unusable input", () => {
    expect(normalizeBrowserHomeUrl("")).toBe(defaultBrowserHomeUrl);
    expect(normalizeBrowserHomeUrl("   ")).toBe(defaultBrowserHomeUrl);
    expect(normalizeBrowserHomeUrl("javascript:alert(1)")).toBe(defaultBrowserHomeUrl);
    expect(normalizeBrowserHomeUrl("file:///etc/passwd")).toBe(defaultBrowserHomeUrl);
    expect(normalizeBrowserHomeUrl("https://")).toBe(defaultBrowserHomeUrl);
  });

  it("feeds new tabs once configured", () => {
    configureBrowserHomeUrl("example.com/start");
    expect(browserHomeUrl()).toBe("https://example.com/start");
    expect(createBrowserTabState().url).toBe("https://example.com/start");
  });

  it("preserves the agent-owned tab marker", () => {
    const state = parseBrowserTabState({ ...createBrowserTabState(), agentOwned: true });
    expect(state.agentOwned).toBe(true);
  });
});
