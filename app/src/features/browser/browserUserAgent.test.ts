import { describe, expect, it } from "vitest";
import { safariCompatibleUserAgent } from "./browserUserAgent";

const webviewUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

describe("browser user agent", () => {
  it("identifies a current macOS WKWebView as Safari", () => {
    expect(safariCompatibleUserAgent(webviewUserAgent, "macos", "26.5.2")).toBe(
      `${webviewUserAgent} Version/26.0 Safari/605.1.15`,
    );
  });

  it("does not replace the native user agent on other platforms", () => {
    expect(safariCompatibleUserAgent(webviewUserAgent, "windows", "11")).toBeUndefined();
  });

  it("preserves an existing Safari user agent", () => {
    const safari = `${webviewUserAgent} Version/26.0 Safari/605.1.15`;
    expect(safariCompatibleUserAgent(safari, "macos", "26.5.2")).toBe(safari);
  });

  it("removes application product tokens from the Safari-compatible user agent", () => {
    const applicationUserAgent = `${webviewUserAgent} Misty/0.1`;
    expect(safariCompatibleUserAgent(applicationUserAgent, "macos", "26.5.2")).toBe(
      `${webviewUserAgent} Version/26.0 Safari/605.1.15`,
    );
  });
});
