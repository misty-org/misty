import { describe, expect, it } from "vitest";

import { browserBoundsAtAppZoom, normalizeBrowserAddress } from "./BrowserWorkspace";
import { normalizeSdkBrowserAddress } from "./SDKBrowserView";

describe("browser address normalization", () => {
  it("preserves explicit web URLs", () => {
    expect(normalizeBrowserAddress("https://example.com/path?q=misty")).toBe(
      "https://example.com/path?q=misty",
    );
  });

  it("adds HTTPS to hostnames", () => {
    expect(normalizeBrowserAddress("example.com/docs")).toBe("https://example.com/docs");
  });

  it("turns free text into a search", () => {
    expect(normalizeBrowserAddress("human agent workspace")).toBe(
      "https://www.google.com/search?q=human%20agent%20workspace",
    );
  });

  it("connects to local ports and localhost over HTTP", () => {
    expect(normalizeBrowserAddress("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBrowserAddress("localhost:3000/dashboard?a=1#section")).toBe(
      "http://localhost:3000/dashboard?a=1#section",
    );
    expect(normalizeBrowserAddress("localhost")).toBe("http://localhost");
    expect(normalizeBrowserAddress("localhost/test")).toBe("http://localhost/test");
    expect(normalizeBrowserAddress("devbox:3000")).toBe("http://devbox:3000");
  });

  it("connects to IP addresses over HTTP", () => {
    expect(normalizeBrowserAddress("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(normalizeBrowserAddress("127.0.0.1")).toBe("http://127.0.0.1");
    expect(normalizeBrowserAddress("0.0.0.0:4000")).toBe("http://0.0.0.0:4000");
    expect(normalizeBrowserAddress("192.168.1.1")).toBe("http://192.168.1.1");
    expect(normalizeBrowserAddress("192.168.1.50:3000/api")).toBe(
      "http://192.168.1.50:3000/api",
    );
    expect(normalizeBrowserAddress("10.0.0.1:5173")).toBe("http://10.0.0.1:5173");
    expect(normalizeBrowserAddress("[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("connects to local network domains over HTTP", () => {
    expect(normalizeBrowserAddress("macbook.local:3000")).toBe("http://macbook.local:3000");
    expect(normalizeBrowserAddress("macbook.local")).toBe("http://my-mac.local".replace("my-mac", "macbook"));
    expect(normalizeBrowserAddress("host.docker.internal:8080")).toBe(
      "http://host.docker.internal:8080",
    );
  });

  it("keeps an empty omnibox or about:blank on the native blank page", () => {
    expect(normalizeBrowserAddress("   ")).toBe("about:blank");
    expect(normalizeBrowserAddress("about:blank")).toBe("about:blank");
  });

  it("normalizes embedded browser addresses equivalently in normalizeSdkBrowserAddress", () => {
    expect(normalizeSdkBrowserAddress("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeSdkBrowserAddress("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(normalizeSdkBrowserAddress("192.168.1.1")).toBe("http://192.168.1.1");
    expect(normalizeSdkBrowserAddress("example.com")).toBe("https://example.com");
  });
});

describe("native browser bounds", () => {
  it("converts zoomed CSS pixels into window coordinates", () => {
    expect(browserBoundsAtAppZoom({ x: 72, y: 110, width: 900, height: 600 }, 1.25)).toEqual({
      x: 90,
      y: 137.5,
      width: 1125,
      height: 750,
    });
  });

  it("falls back safely when the app zoom is invalid", () => {
    const bounds = { x: 72, y: 110, width: 900, height: 600 };
    expect(browserBoundsAtAppZoom(bounds, Number.NaN)).toEqual(bounds);
  });
});
