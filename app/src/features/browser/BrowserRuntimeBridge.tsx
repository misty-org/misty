import { dockLeaves, useWorkspaceStore, type WorkspaceDockNode } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  browserTabIdForRuntime,
  hideAllBrowserWebviews,
  requestBrowserWebviewLayoutByRuntimeId,
  setBrowserPointerGestureActive,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
} from "./browserRuntime";

const browserBlockingOverlaySelector = [
  '[data-slot="dropdown-menu-content"][data-state="open"]',
  '[data-slot="dropdown-menu-sub-content"][data-state="open"]',
  '[data-slot="popover-content"][data-state="open"]',
  '[data-slot="select-content"][data-state="open"]',
  '[data-slot="dialog-content"][data-state="open"]',
  '[data-slot="alert-dialog-content"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="dialog"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(",");

export function browserBlockingOverlayOpen(root: ParentNode = document): boolean {
  return root.querySelector(browserBlockingOverlaySelector) !== null;
}

export function activeBrowserSurfaceExists(root: WorkspaceDockNode): boolean {
  return dockLeaves(root).some((pane) => {
    const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId);
    return activeTab?.surfaceId === "browser";
  });
}

interface BrowserPageEvent {
  id: string;
  url: string;
  phase: "started" | "finished";
}

interface BrowserTitleEvent {
  id: string;
  title: string;
}

interface BrowserFaviconEvent {
  id: string;
  url: string;
}

interface BrowserPopupEvent {
  sourceId: string;
  url: string;
}

interface BrowserCursorEvent {
  id: string;
  cursor: string;
}

interface BrowserDownloadEvent {
  tabId: string;
  path: string;
  state: "requested" | "finished" | "failed";
  success: boolean;
  error?: string;
}

export function BrowserRuntimeBridge() {
  const navigate = useNavigate();
  const browserSurfaceActive = useWorkspaceStore((state) =>
    activeBrowserSurfaceExists(state.layout.root),
  );

  useLayoutEffect(() => {
    if (!browserSurfaceActive) void hideAllBrowserWebviews();
  }, [browserSurfaceActive]);

  useEffect(() => {
    const beginPointerGesture = () => setBrowserPointerGestureActive(true);
    const endPointerGesture = () => setBrowserPointerGestureActive(false);
    window.addEventListener("pointerdown", beginPointerGesture, true);
    window.addEventListener("pointerup", endPointerGesture, true);
    window.addEventListener("pointercancel", endPointerGesture, true);
    window.addEventListener("blur", endPointerGesture);
    return () => {
      window.removeEventListener("pointerdown", beginPointerGesture, true);
      window.removeEventListener("pointerup", endPointerGesture, true);
      window.removeEventListener("pointercancel", endPointerGesture, true);
      window.removeEventListener("blur", endPointerGesture);
      setBrowserPointerGestureActive(false);
    };
  }, []);

  useEffect(() => {
    const openPanes = new Set<string>();
    const reason = "ai-drawer";
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId?: string; open?: boolean }>).detail;
      if (!detail?.paneId) return;
      if (detail.open) openPanes.add(detail.paneId);
      else openPanes.delete(detail.paneId);
      setBrowserWebviewsSuspended(openPanes.size > 0, reason);
    };
    window.addEventListener("misty:ai-drawer-visibility", update);
    return () => {
      window.removeEventListener("misty:ai-drawer-visibility", update);
      setBrowserWebviewsSuspended(false, reason);
    };
  }, []);

  useEffect(() => {
    const reason = "dom-overlay";
    // This observer is a fallback for app overlays outside Browser chrome.
    // Browser toolbar menus suspend synchronously in onOpenChange so their
    // first portal frame cannot race the native child WebView.
    let frame = 0;
    const synchronize = () => {
      frame = 0;
      setBrowserWebviewsSuspended(browserBlockingOverlayOpen(), reason);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(synchronize);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
      subtree: true,
    });
    synchronize();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      setBrowserWebviewsSuspended(false, reason);
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const listeners = Promise.all([
      listen<BrowserPageEvent>("misty://browser-page", ({ payload }) => {
        if (disposed) return;
        const tabId = browserTabIdForRuntime(payload.id);
        if (!tabId) return;
        useWorkspaceStore.getState().updateBrowserTab(tabId, { url: payload.url });
        if (payload.phase === "finished") {
          useBrowserRuntimeStore.getState().pushHistory(tabId, payload.url);
          // Page completion can race a layout transition that hid the native
          // child. Ask the geometry owner to reconcile bounds and visibility.
          requestBrowserWebviewLayoutByRuntimeId(payload.id);
        }
      }),
      listen<BrowserTitleEvent>("misty://browser-title", ({ payload }) => {
        if (disposed || !payload.title.trim()) return;
        const tabId = browserTabIdForRuntime(payload.id);
        if (tabId) {
          useWorkspaceStore.getState().updateBrowserTab(tabId, { title: payload.title.trim() });
        }
      }),
      listen<BrowserFaviconEvent>("misty://browser-favicon", ({ payload }) => {
        if (disposed || !/^https?:\/\//i.test(payload.url)) return;
        const tabId = browserTabIdForRuntime(payload.id);
        if (tabId) {
          useWorkspaceStore.getState().updateBrowserTab(tabId, { faviconUrl: payload.url });
        }
      }),
      listen<BrowserCursorEvent>("misty://browser-cursor", ({ payload }) => {
        if (disposed) return;
        const tabId = browserTabIdForRuntime(payload.id);
        if (tabId) useBrowserRuntimeStore.getState().setCursor(tabId, payload.cursor);
      }),
      listen<BrowserPopupEvent>("misty://browser-popup", ({ payload }) => {
        if (disposed) return;
        const sourceTabId = browserTabIdForRuntime(payload.sourceId);
        useWorkspaceStore.getState().openBrowserTab({
          url: payload.url,
          sourceTabId: sourceTabId ?? undefined,
        });
        navigate("/browser");
      }),
      listen<BrowserDownloadEvent>("misty://browser-download", ({ payload }) => {
        if (disposed || payload.state === "requested") return;
        const tabId = browserTabIdForRuntime(payload.tabId);
        if (!tabId) return;
        if (payload.success) {
          const name = payload.path.split(/[\\/]/).pop() || "download";
          useBrowserRuntimeStore.getState().setNotice(tabId, `Saved ${name} to Downloads.`);
          window.setTimeout(() => useBrowserRuntimeStore.getState().setNotice(tabId, null), 5_000);
        } else {
          useBrowserRuntimeStore
            .getState()
            .setError(tabId, payload.error || "The download failed.");
        }
      }),
    ]);
    return () => {
      disposed = true;
      void listeners.then((unlisten) => unlisten.forEach((stop) => stop()));
    };
  }, [navigate]);

  return null;
}
