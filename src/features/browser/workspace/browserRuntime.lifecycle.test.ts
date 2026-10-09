import { createBrowserViewState, type WorkspaceView } from "@/features/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserRuntimeResumeEvent,
  closeBrowserRuntime,
  setBrowserWebviewsSuspended,
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

describe("browser native view overlay close and tab close", () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockImplementation((command) =>
      Promise.resolve(command === "browser_webview_reconcile" ? true : undefined),
    );
  });

  it("does not invalidate cached bounds on macOS when closing an overlay", async () => {
    const tab = browserTab("no-flash-on-overlay-close");
    const input = {
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark" as const,
    };
    await syncBrowserWebview(input);
    invoke.mockClear();

    let resumeDispatched = false;
    const onResume = () => {
      resumeDispatched = true;
    };
    window.addEventListener(browserRuntimeResumeEvent, onResume);

    try {
      setBrowserWebviewsSuspended(true, "test-overlay-flash");
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", {
          active: true,
        }),
      );
      invoke.mockClear();

      setBrowserWebviewsSuspended(false, "test-overlay-flash");
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", {
          active: false,
        }),
      );

      // Let animation frames and overlay resume settle
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
      );

      // Ensure browserRuntimeResumeEvent was NOT fired on macOS
      expect(resumeDispatched).toBe(false);

      // Subsequent sync at the same bounds should hit the cache and not invoke reconcile
      await syncBrowserWebview(input);
      expect(invoke).not.toHaveBeenCalledWith("browser_webview_reconcile", expect.anything());
    } finally {
      window.removeEventListener(browserRuntimeResumeEvent, onResume);
    }
  });

  it("invalidates cached bounds on platforms that park child views when closing an overlay", async () => {
    const platformSpy = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    let resumeDispatched = false;
    const onResume = () => {
      resumeDispatched = true;
    };
    window.addEventListener(browserRuntimeResumeEvent, onResume);

    try {
      const tab = browserTab("linux-park-overlay-close");
      const input = {
        tab,
        url: "https://example.com",
        bounds: { x: 10, y: 20, width: 800, height: 600 },
        theme: "dark" as const,
      };
      await syncBrowserWebview(input);
      invoke.mockClear();

      setBrowserWebviewsSuspended(true, "test-linux-overlay");
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", {
          active: true,
        }),
      );
      invoke.mockClear();

      setBrowserWebviewsSuspended(false, "test-linux-overlay");
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("browser_webviews_set_overlay_active", {
          active: false,
        }),
      );

      // On Linux, child views are parked so the resume event must be dispatched
      await vi.waitFor(() => expect(resumeDispatched).toBe(true));

      // Subsequent sync at same bounds must re-reconcile because cached bounds were invalidated
      await syncBrowserWebview(input);
      expect(invoke).toHaveBeenCalledWith("browser_webview_reconcile", expect.anything());
    } finally {
      window.removeEventListener(browserRuntimeResumeEvent, onResume);
      platformSpy.mockRestore();
    }
  });

  it("closes the native webview and cleans up runtime state when the tab closes", async () => {
    const tab = browserTab("close-runtime-tab");
    const input = {
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark" as const,
    };
    await syncBrowserWebview(input);
    useBrowserRuntimeStore.getState().ensureHistory(tab.id, "https://example.com");
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    invoke.mockClear();

    await closeBrowserRuntime(tab, () => true);

    expect(invoke).toHaveBeenCalledWith("browser_webview_close", {
      request: { id: `tab-${tab.instanceKey}` },
    });
    expect(useBrowserRuntimeStore.getState().histories[tab.id]).toBeUndefined();
    expect(useBrowserRuntimeStore.getState().loading[tab.id]).toBeUndefined();
  });
});
