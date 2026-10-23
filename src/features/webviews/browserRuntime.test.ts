import { createBrowserViewState, type WorkspaceView } from "@/features/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideBrowserWebview,
  setBrowserPointerTrackingEnabled,
  browserRuntimeId,
  switchBrowserPages,
  syncBrowserWebview,
  useBrowserRuntimeStore,
} from "./browserRuntime";

const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>((command) =>
    Promise.resolve(command === "browser_webview_reconcile" ? true : undefined),
  ),
);

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function browserTab(instanceKey: string): WorkspaceView {
  return {
    id: `tab:${instanceKey}`,
    surfaceId: "browser",
    groupKey: "tool:browser",
    instanceKey,
    title: "Browser",
    route: "/browser",
    sidebarVisible: true,
    state: createBrowserViewState("https://example.com"),
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

  it("keeps compatibility recovery scoped to its tab", () => {
    const tab = browserTab("challenge-recovery");
    useBrowserRuntimeStore.getState().setCompatibilityIssue(tab.id, {
      kind: "cloudflare_challenge",
      url: "https://leetcode.com/",
    });

    expect(useBrowserRuntimeStore.getState().compatibilityIssues[tab.id]?.url).toBe(
      "https://leetcode.com/",
    );

    useBrowserRuntimeStore.getState().removeTab(tab.id);
    expect(useBrowserRuntimeStore.getState().compatibilityIssues[tab.id]).toBeUndefined();
  });

  it("enables page pointer IPC only while the Misty presence is active", async () => {
    setBrowserPointerTrackingEnabled(true);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_pointer_tracking", {
        enabled: true,
      }),
    );

    // A second user of tracking changes nothing, and tracking stays on until both let go.
    invoke.mockClear();
    setBrowserPointerTrackingEnabled(true);
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    setBrowserPointerTrackingEnabled(false);
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();

    setBrowserPointerTrackingEnabled(false);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webviews_set_pointer_tracking", {
        enabled: false,
      }),
    );
  });

  it("switches pages in one native call the moment the active tab changes", async () => {
    const shown = browserTab("instant-shown");
    const coming = browserTab("instant-coming");
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    await syncBrowserWebview({ tab: coming, url: "https://example.com", bounds, theme: "dark" });
    await hideBrowserWebview(coming);
    await syncBrowserWebview({ tab: shown, url: "https://example.com", bounds, theme: "dark" });
    const comingId = browserRuntimeId(coming);
    invoke.mockClear();
    invoke.mockImplementation((command) =>
      Promise.resolve(command === "browser_webviews_show_only" ? [comingId] : undefined),
    );
    const presented = (tab: WorkspaceView) =>
      useBrowserRuntimeStore.getState().presented[tab.id] ?? false;
    expect(presented(shown)).toBe(true);

    switchBrowserPages([comingId]);

    // One call, sent at once, before anything measures; the page that came up is presented
    // and the one that went under is not.
    expect(invoke).toHaveBeenCalledWith("browser_webviews_show_only", {
      request: { ids: [comingId] },
    });
    await vi.waitFor(() => expect(presented(coming)).toBe(true));
    expect(presented(shown)).toBe(false);
  });

  it("keeps the host filled until a new page is really on screen", async () => {
    const tab = browserTab("presented-fill");
    const bounds = { x: 10, y: 20, width: 800, height: 600 };
    let held = true;
    invoke.mockImplementation((command) =>
      Promise.resolve(
        command === "browser_webview_reconcile"
          ? true
          : command === "browser_webview_held"
            ? held
            : undefined,
      ),
    );
    const presented = () => useBrowserRuntimeStore.getState().presented[tab.id] ?? false;

    await syncBrowserWebview({ tab, url: "https://example.com", bounds, theme: "dark" });
    expect(presented()).toBe(false);

    // The page paints and is revealed; its layout runs again.
    held = false;
    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { ...bounds, width: 801 },
      theme: "dark",
    });
    expect(presented()).toBe(true);

    await hideBrowserWebview(tab);
    expect(presented()).toBe(false);
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
      "browser_webview_held",
    ]);
    const createArgs = invoke.mock.calls[0]?.[1] as { request?: Record<string, unknown> };
    expect(createArgs.request).not.toHaveProperty("userAgent");
    expect(createArgs.request).toHaveProperty("nativeLiveResize", false);
  });

  it("reconfigures native live resize without requiring a bounds change", async () => {
    const tab = browserTab("native-live-resize-mode");
    const input = {
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark" as const,
    };
    await syncBrowserWebview({ ...input, nativeLiveResize: false });
    invoke.mockClear();

    await syncBrowserWebview({ ...input, nativeLiveResize: true });

    expect(invoke).toHaveBeenCalledWith("browser_webview_reconcile", {
      request: { id: expect.any(String), nativeLiveResize: true, ...input.bounds },
    });
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
});
