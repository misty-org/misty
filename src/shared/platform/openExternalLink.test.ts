import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openUrl: vi.fn(async () => undefined) }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "windows" }));

import {
  configureMistyBrowserLinkOpener,
  configureProviderAuthorizationLinkOpener,
  installExternalLinkRouting,
  normalizeExternalUrl,
  openExternalLink,
  openSystemExternalLink,
  openProviderAuthorizationLink,
} from "@/shared/platform/openExternalLink";

afterEach(() => {
  configureProviderAuthorizationLinkOpener(null);
  mocks.openUrl.mockClear();
  document.body.replaceChildren();
});

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

describe("openExternalLink", () => {
  it("opens web destinations in Misty Browser by default", async () => {
    const openInMisty = vi.fn();
    configureMistyBrowserLinkOpener(openInMisty);

    await openExternalLink("https://example.com/docs");

    expect(openInMisty).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("routes plain absolute anchors through Misty Browser", async () => {
    const openInMisty = vi.fn();
    configureMistyBrowserLinkOpener(openInMisty);
    const uninstall = installExternalLinkRouting();
    document.body.innerHTML = '<a href="https://example.com/help" target="_blank">Help</a>';

    document.querySelector<HTMLAnchorElement>("a")?.click();

    await vi.waitFor(() => expect(openInMisty).toHaveBeenCalledWith("https://example.com/help"));
    uninstall();
  });

  it("routes legacy system-browser callers through Misty too", async () => {
    const openInMisty = vi.fn();
    configureMistyBrowserLinkOpener(openInMisty);
    await openSystemExternalLink("https://example.com/system");
    expect(openInMisty).toHaveBeenCalledWith("https://example.com/system");
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("does not escape to the system browser when Misty fails", async () => {
    configureMistyBrowserLinkOpener(async () => {
      throw new Error("view unavailable");
    });
    await expect(openSystemExternalLink("https://example.com")).rejects.toThrow("view unavailable");
    await expect(
      openProviderAuthorizationLink("https://login.microsoftonline.com"),
    ).rejects.toThrow("view unavailable");
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("routes middle-clicks and former system-link overrides into Misty", async () => {
    const openInMisty = vi.fn();
    configureMistyBrowserLinkOpener(openInMisty);
    const uninstall = installExternalLinkRouting();
    document.body.innerHTML =
      '<a href="https://example.com/help" data-open-system-external="true">Help</a>';
    document
      .querySelector("a")!
      .dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    expect(openInMisty).toHaveBeenCalledWith("https://example.com/help");
    expect(mocks.openUrl).not.toHaveBeenCalled();
    uninstall();
  });
});
