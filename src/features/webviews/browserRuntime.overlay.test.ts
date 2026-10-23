import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setBrowserPointerGestureActive,
  setBrowserWebviewsSuspended,
  reconcileBrowserOverlayState,
} from "./browserRuntime";

const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>((command) =>
    Promise.resolve(command === "browser_webview_reconcile" ? true : undefined),
  ),
);

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("browser overlay ownership", () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockImplementation((command) =>
      Promise.resolve(command === "browser_webview_reconcile" ? true : undefined),
    );
  });

  it("reasserts idle native ownership after the host reloads", async () => {
    reconcileBrowserOverlayState();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: false }),
    );
    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false);
  });

  it("recovers a lost pointer release without dismissing real overlays", async () => {
    setBrowserWebviewsSuspended(true, "recovery-test");
    setBrowserPointerGestureActive(true);
    reconcileBrowserOverlayState();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: true }),
    );
    invoke.mockClear();
    setBrowserWebviewsSuspended(false, "recovery-test");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: false }),
    );
  });

  it("keeps the native page live underneath app overlays", async () => {
    setBrowserWebviewsSuspended(true, "test-live-overlay");

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: true }),
    );
    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("browser_webviews_hide_all");

    setBrowserWebviewsSuspended(false, "test-live-overlay");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: false }),
    );
    await vi.waitFor(() =>
      expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false),
    );
  });

  it("keeps the page host transparent until the page is back above the renderer", async () => {
    setBrowserWebviewsSuspended(true, "test-resume-order");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: true }),
    );

    let releaseRaise: (() => void) | undefined;
    invoke.mockImplementation((command, args) => {
      const active = (args as { active?: boolean } | undefined)?.active;
      if (command === "browser_webviews_set_overlay_active" && active === false) {
        return new Promise<void>((resolve) => {
          releaseRaise = resolve;
        });
      }
      return Promise.resolve(command === "browser_webview_reconcile" ? true : undefined);
    });

    setBrowserWebviewsSuspended(false, "test-resume-order");
    await vi.waitFor(() => expect(releaseRaise).toBeTypeOf("function"));
    // The page is still below the renderer, so the host must not paint its fill over it yet.
    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(true);

    releaseRaise?.();
    await vi.waitFor(() =>
      expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false),
    );
    expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: false });
  });

  it("does not raise the native page until the closing pointer gesture finishes", async () => {
    setBrowserPointerGestureActive(true);
    setBrowserWebviewsSuspended(true, "test-pointer-menu");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: true }),
    );
    invoke.mockClear();

    setBrowserWebviewsSuspended(false, "test-pointer-menu");
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    expect(invoke).not.toHaveBeenCalledWith("browser_webviews_set_overlay_active", {
      active: false,
    });

    setBrowserPointerGestureActive(false);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: false }),
    );
  });
});
