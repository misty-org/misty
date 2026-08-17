import { createBrowserTabState, type WorkspaceTab } from "@/features/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideAllBrowserWebviews,
  setBrowserWebviewsSuspended,
  syncBrowserWebview,
} from "./browserRuntime";

const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>((command) =>
    Promise.resolve(command === "browser_webview_reconcile" ? true : undefined),
  ),
);

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function browserTab(instanceKey: string): WorkspaceTab {
  return {
    id: `tab:${instanceKey}`,
    surfaceId: "browser",
    groupKey: "tool:browser",
    instanceKey,
    title: "Browser",
    route: "/browser",
    sidebarVisible: true,
    state: createBrowserTabState("https://example.com"),
    createdAt: 1,
    lastFocusedAt: 1,
  };
}

describe("browser native view synchronization", () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockImplementation((command) =>
      Promise.resolve(command === "browser_webview_reconcile" ? true : undefined),
    );
  });

  it("forces a native layout pass immediately after creating the child", async () => {
    const tab = browserTab("initial-layout");
    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "browser_webview_create",
      "browser_webview_reconcile",
    ]);
  });

  it("resizes a visible child in place and reconciles native visibility", async () => {
    const tab = browserTab("resize-in-place");
    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });
    invoke.mockClear();

    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 12, y: 20, width: 798, height: 600 },
      theme: "dark",
    });

    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["browser_webview_reconcile"]);
  });

  it("ignores subpixel measurement noise while still reconciling visibility", async () => {
    const tab = browserTab("subpixel-noise");
    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });
    invoke.mockClear();

    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10.1, y: 20.1, width: 800.1, height: 600.1 },
      theme: "dark",
    });

    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["browser_webview_reconcile"]);
  });

  it("recreates a native child when frontend state is stale", async () => {
    const tab = browserTab("native-recovery");
    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });
    invoke.mockClear();
    invoke
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true);

    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 12, y: 20, width: 798, height: 600 },
      theme: "dark",
    });

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "browser_webview_reconcile",
      "browser_webview_create",
      "browser_webview_reconcile",
    ]);
  });

  it("hides native children even when frontend visibility state is stale", async () => {
    await hideAllBrowserWebviews();

    expect(invoke).toHaveBeenCalledWith("browser_webviews_hide_all");
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
    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false);
  });
});
