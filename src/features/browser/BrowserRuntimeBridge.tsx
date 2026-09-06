import {
  dockLeaves,
  useRecentToolsStore,
  useWorkspaceStore,
  type WorkspaceDockNode,
} from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { subscribeEmbeddedBrowserSuspension } from "@/shared/platform/browserSuspensionSignal";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  browserTabIdForRuntime,
  captureNativeBrowserRegion,
  parkAllBrowserWebviews,
  requestBrowserWebviewLayoutByRuntimeId,
  setBrowserPointerGestureActive,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
} from "./browserRuntime";
import { openBrowserPopup } from "./openBrowserPopup";
import { useAiSurfaceStore } from "@/features/ai-surface";
import { captureAttachmentFromDataUrl } from "@/features/ai-surface/captureAttachment";

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
    return (
      activeTab?.surfaceId === "browser" ||
      (activeTab?.surfaceId === "official-app" && activeTab.groupKey === "app:browser")
    );
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

interface BrowserCompatibilityEvent {
  id: string;
  kind: "cloudflare_challenge";
  url: string;
}

interface BrowserPopupEvent {
  sourceId: string;
  url: string;
}

interface BrowserPointerEvent {
  id: string;
  x: number;
  y: number;
  inside: boolean;
}

interface BrowserFocusEvent {
  id: string;
}

export function focusBrowserRuntimeTab(runtimeId: string): boolean {
  const tabId = browserTabIdForRuntime(runtimeId);
  if (!tabId || !useWorkspaceStore.getState().focusTab(tabId)) return false;
  window.dispatchEvent(new CustomEvent("misty:focus-workspace-tab", { detail: { tabId } }));
  return true;
}

interface BrowserDownloadEvent {
  tabId: string;
  path: string;
  state: "requested" | "finished" | "failed";
  success: boolean;
  error?: string;
}

interface BrowserCompanionEvent {
  id: string;
  kind: "submit" | "action" | "capture";
  prompt: string;
  actionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IosBrowserEvent {
  kind: "page" | "title" | "popup" | "download" | "error";
  id?: string;
  sourceId?: string;
  phase?: "started" | "finished";
  url?: string;
  title?: string;
  path?: string;
  state?: "requested" | "finished" | "failed";
  success?: boolean;
  error?: string;
  message?: string;
}

export function BrowserRuntimeBridge() {
  const navigate = useNavigate();
  const browserSurfaceActive = useWorkspaceStore((state) =>
    activeBrowserSurfaceExists(state.layout.root),
  );
  useEffect(
    () =>
      subscribeEmbeddedBrowserSuspension((suspended, reason) =>
        setBrowserWebviewsSuspended(suspended, reason),
      ),
    [],
  );
  useLayoutEffect(() => {
    if (browserSurfaceActive) return;
    // Commit the opaque workspace surface first. On the next frame Windows
    // can keep each live browser child parked beneath it, ready for an
    // immediate reveal when the user returns.
    const frame = window.requestAnimationFrame(() => void parkAllBrowserWebviews());
    return () => window.cancelAnimationFrame(frame);
  }, [browserSurfaceActive]);

  useEffect(() => {
    if (!isNativeMobileBuild) return;
    const onIosBrowserEvent = (event: Event) => {
      const payload = (event as CustomEvent<IosBrowserEvent>).detail;
      if (payload.kind === "popup" && payload.url) {
        useWorkspaceStore.getState().openBrowserTab({
          url: payload.url,
          sourceTabId: payload.sourceId
            ? (browserTabIdForRuntime(payload.sourceId) ?? undefined)
            : undefined,
        });
        navigate("/browser");
        return;
      }
      if (!payload.id) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (!tabId) return;
      if (payload.kind === "page" && payload.url && payload.phase) {
        useBrowserRuntimeStore.getState().setLoading(tabId, payload.phase === "started");
        useWorkspaceStore.getState().updateBrowserTab(tabId, { url: payload.url });
        if (payload.phase === "finished") {
          useBrowserRuntimeStore.getState().pushHistory(tabId, payload.url);
          requestBrowserWebviewLayoutByRuntimeId(payload.id);
        }
      } else if (payload.kind === "title" && payload.title?.trim()) {
        useWorkspaceStore.getState().updateBrowserTab(tabId, { title: payload.title.trim() });
      } else if (payload.kind === "download" && payload.state !== "requested") {
        if (payload.success) {
          const name = payload.path?.split(/[\\/]/).pop() || "download";
          useBrowserRuntimeStore
            .getState()
            .setNotice(tabId, `Downloaded ${name}. Use Share or Export to save it in Files.`);
        } else {
          useBrowserRuntimeStore
            .getState()
            .setError(tabId, payload.error || "The download failed.");
        }
      } else if (payload.kind === "error") {
        useBrowserRuntimeStore
          .getState()
          .setError(tabId, payload.message || "The page could not be loaded.");
      }
    };
    window.addEventListener("misty:ios-browser-event", onIosBrowserEvent);
    return () => window.removeEventListener("misty:ios-browser-event", onIosBrowserEvent);
  }, [navigate]);

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
        if (payload.phase === "started") {
          useBrowserRuntimeStore.getState().setCompatibilityIssue(tabId, null);
          useBrowserRuntimeStore.getState().setLoading(tabId, true);
        }
        useWorkspaceStore.getState().updateBrowserTab(tabId, { url: payload.url });
        if (payload.phase === "finished") {
          useBrowserRuntimeStore.getState().setLoading(tabId, false);
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
      listen<BrowserCompatibilityEvent>("misty://browser-compatibility", ({ payload }) => {
        if (
          disposed ||
          payload.kind !== "cloudflare_challenge" ||
          !/^https?:\/\//i.test(payload.url)
        ) {
          return;
        }
        const tabId = browserTabIdForRuntime(payload.id);
        if (tabId) {
          useBrowserRuntimeStore.getState().setCompatibilityIssue(tabId, {
            kind: payload.kind,
            url: payload.url,
          });
        }
      }),
      listen<BrowserPointerEvent>("misty://browser-pointer", ({ payload }) => {
        if (
          disposed ||
          !payload.inside ||
          !Number.isFinite(payload.x) ||
          !Number.isFinite(payload.y)
        ) {
          return;
        }
        const tabId = browserTabIdForRuntime(payload.id);
        if (!tabId) return;
        const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find(
          (candidate) => candidate.activeTabId === tabId,
        );
        if (!pane) return;
        const workspace = document.querySelector<HTMLElement>(
          `[data-browser-workspace-tab="${CSS.escape(tabId)}"]`,
        );
        const host = workspace?.querySelector<HTMLElement>("[data-browser-page-host]");
        if (!host) return;
        const rect = host.getBoundingClientRect();
        const x = Math.min(rect.right, Math.max(rect.left, rect.left + payload.x));
        const y = Math.min(rect.bottom, Math.max(rect.top, rect.top + payload.y));
        window.dispatchEvent(
          new CustomEvent("misty:browser-pointer", {
            detail: { x, y, paneId: pane.id },
          }),
        );
      }),
      listen<BrowserFocusEvent>("misty://browser-focus", ({ payload }) => {
        if (!disposed) focusBrowserRuntimeTab(payload.id);
      }),
      listen<BrowserCompanionEvent>("misty://browser-companion", ({ payload }) => {
        if (disposed) return;
        const tabId = browserTabIdForRuntime(payload.id);
        if (!tabId) return;
        const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find(
          (candidate) => candidate.activeTabId === tabId,
        );
        if (!pane) return;
        const ai = useAiSurfaceStore.getState();
        const registration = Object.values(ai.registrations).find(
          (candidate) => candidate.paneId === pane.id,
        );
        if (!registration) return;
        if (payload.kind === "submit") {
          ai.setPrompt(registration.accountId, pane.id, payload.prompt);
          void ai.submit(registration.accountId, pane.id, registration.adapter);
          return;
        }
        if (payload.kind === "action") {
          const action = registration.adapter
            .getSuggestedActions?.()
            .find((candidate) => candidate.id === payload.actionId);
          if (action) void ai.submit(registration.accountId, pane.id, registration.adapter, action);
          return;
        }
        if (
          payload.width < 8 ||
          payload.height < 8 ||
          ![payload.x, payload.y, payload.width, payload.height].every(Number.isFinite)
        ) {
          return;
        }
        void captureNativeBrowserRegion(payload.id, payload)
          .then(({ dataUrl, width, height }) =>
            captureAttachmentFromDataUrl(dataUrl, width, height),
          )
          .then((capture) => ai.setCapture(registration.accountId, pane.id, capture))
          .catch((error: unknown) =>
            useBrowserRuntimeStore
              .getState()
              .setError(
                tabId,
                error instanceof Error
                  ? error.message
                  : typeof error === "string"
                    ? error
                    : "Misty could not capture that region.",
              ),
          );
      }),
      listen<BrowserPopupEvent>("misty://browser-popup", ({ payload }) => {
        if (disposed) return;
        const tab = openBrowserPopup(payload);
        if (!tab) return;
        useRecentToolsStore.getState().recordToolUsage("browser");
        navigate(tab.route);
      }),
      listen<BrowserDownloadEvent>("misty://browser-download", ({ payload }) => {
        if (disposed || payload.state === "requested") return;
        const tabId = browserTabIdForRuntime(payload.tabId);
        if (!tabId) return;
        if (payload.success) {
          const name = payload.path.split(/[\\/]/).pop() || "download";
          useBrowserRuntimeStore
            .getState()
            .setNotice(
              tabId,
              isNativeMobileBuild
                ? `Downloaded ${name}. Use Share or Export to save it in Files.`
                : `Saved ${name} to Downloads.`,
            );
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
