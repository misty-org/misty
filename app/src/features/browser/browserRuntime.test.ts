import { createBrowserTabState, type WorkspaceTab } from "@/features/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideAllBrowserWebviews,
  hideBrowserWebview,
  setBrowserPointerGestureActive,
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

  it("ignores subpixel measurement noise without touching the native frame", async () => {
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

    expect(invoke).not.toHaveBeenCalled();
  });

  it("coalesces live-resize updates so the newest native bounds win", async () => {
    const tab = browserTab("coalesced-live-resize");
    let releaseFirstReconcile: ((exists: boolean) => void) | undefined;
    const firstReconcile = new Promise<boolean>((resolve) => {
      releaseFirstReconcile = resolve;
    });
    let reconcileCount = 0;
    invoke.mockImplementation((command) => {
      if (command !== "browser_webview_reconcile") return Promise.resolve(undefined);
      reconcileCount += 1;
      return reconcileCount === 1 ? firstReconcile : Promise.resolve(true);
    });

    const first = syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });
    await vi.waitFor(() => expect(reconcileCount).toBe(1));
    const intermediate = syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 700, height: 560 },
      theme: "dark",
    });
    const final = syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 620, height: 520 },
      theme: "dark",
    });
    releaseFirstReconcile?.(true);
    await Promise.all([first, intermediate, final]);

    const reconciledWidths = invoke.mock.calls
      .filter(([command]) => command === "browser_webview_reconcile")
      .map(([, args]) => (args as { request: { width: number } }).request.width);
    expect(reconciledWidths).toEqual([800, 620]);
  });

  it("hides a child when its Browser surface closes during native creation", async () => {
    const tab = browserTab("hide-during-create");
    let releaseReconcile: ((exists: boolean) => void) | undefined;
    const reconcile = new Promise<boolean>((resolve) => {
      releaseReconcile = resolve;
    });
    invoke.mockImplementation((command) =>
      command === "browser_webview_reconcile" ? reconcile : Promise.resolve(undefined),
    );

    const syncing = syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webview_reconcile", expect.anything()),
    );
    const hiding = hideBrowserWebview(tab);
    releaseReconcile?.(true);
    await Promise.all([syncing, hiding]);

    const commands = invoke.mock.calls.map(([command]) => command);
    expect(commands[commands.length - 1]).toBe("browser_webview_hide");
    expect(commands.filter((command) => command === "browser_webview_hide")).toHaveLength(2);
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
    await vi.waitFor(() =>
      expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false),
    );
  });

  it("switches overlay input ownership without a renderer repaint delay", async () => {
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
    expect(document.documentElement.hasAttribute("data-browser-overlay-active")).toBe(false);

    releaseRaise?.();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", { active: false }),
    );
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
