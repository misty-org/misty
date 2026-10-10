import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import type { NavigateFunction } from "react-router-dom";
import type { BrowserAskSnapshot } from "@/features/global-search/browserAskContext";
import { useBrowserDownloadsStore } from "@/features/browser/library";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
import { browserTabIdForRuntime, useBrowserRuntimeStore } from "./browserRuntime";
import { openBrowserPopup } from "./openBrowserPopup";

interface BrowserPopupEvent {
  sourceId: string;
  url: string;
  popupInstanceKey?: string;
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
interface BrowserDownloadEvent {
  downloadId: string;
  tabId: string;
  path: string;
  state: "requested" | "finished" | "failed";
  success: boolean;
  error?: string;
}

/** A native page took keyboard focus, which the renderer's DOM never hears about. Drop the DOM's
 * focus too, so a field that kept it (the address bar shows its draft while focused) lets go. */
function releaseRendererFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}

function focusBrowserRuntimeTab(runtimeId: string): boolean {
  const tabId = browserTabIdForRuntime(runtimeId);
  return tabId ? focusBrowserTab(tabId) : false;
}

/** The host reports a click on a native page before the page handles it; the
 * page host under that point names the tab whose pane becomes active. */
function focusBrowserPageAt(x: number, y: number): boolean {
  for (const host of document.querySelectorAll<HTMLElement>("[data-browser-page-host]")) {
    const rect = host.getBoundingClientRect();
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
    const tabId = host.closest<HTMLElement>("[data-browser-workspace-tab]")?.dataset
      .browserWorkspaceTab;
    if (tabId) return focusBrowserTab(tabId);
  }
  return false;
}

function focusBrowserTab(tabId: string): boolean {
  if (!useWorkspaceStore.getState().focusView(tabId)) return false;
  window.dispatchEvent(
    new CustomEvent("misty:focus-workspace-tab", {
      detail: {
        tabId,
      },
    }),
  );
  return true;
}

interface BrowserInteractionListenerOptions {
  isDisposed: () => boolean;
  navigate: NavigateFunction;
}

/** Pointer, focus, popup, download, open-URL and ask-context events from native pages. */
export function listenBrowserInteractionEvents({
  isDisposed,
  navigate,
}: BrowserInteractionListenerOptions): Promise<UnlistenFn>[] {
  return [
    listen<BrowserPointerEvent>("misty://browser-pointer", ({ payload }) => {
      if (
        isDisposed() ||
        !payload.inside ||
        !Number.isFinite(payload.x) ||
        !Number.isFinite(payload.y)
      ) {
        return;
      }
      const tabId = browserTabIdForRuntime(payload.id);
      if (!tabId) return;
      const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find(
        (candidate) => candidate.activeViewId === tabId,
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
          detail: {
            x,
            y,
            paneId: pane.id,
          },
        }),
      );
    }),
    listen<BrowserFocusEvent>("misty://browser-focus", ({ payload }) => {
      if (isDisposed()) return;
      releaseRendererFocus();
      focusBrowserRuntimeTab(payload.id);
    }),
    listen<{ x: number; y: number }>("misty://browser-page-pointer-down", ({ payload }) => {
      const scale = getAppliedAppRenderScale();
      if (isDisposed()) return;
      releaseRendererFocus();
      focusBrowserPageAt(payload.x / scale, payload.y / scale);
    }),
    listen<BrowserAskSnapshot>("misty://browser-ask-context", ({ payload }) => {
      if (isDisposed()) return;
      focusBrowserRuntimeTab(payload.id);
      void import("@/features/global-search/browserAskContext")
        .then(({ openBrowserAsk }) => openBrowserAsk(payload))
        .catch((error: unknown) => {
          const tabId = browserTabIdForRuntime(payload.id);
          if (tabId)
            useBrowserRuntimeStore
              .getState()
              .setError(
                tabId,
                error instanceof Error ? error.message : "Misty could not open this context.",
              );
        });
    }),
    listen<string>("misty://open-web-url", ({ payload }) => {
      if (isDisposed() || !/^https?:\/\//i.test(payload)) return;
      const tab = useWorkspaceStore.getState().openBrowserView({
        url: payload,
      });
      if (tab) navigate(tab.route);
    }),
    listen<BrowserPopupEvent>("misty://browser-popup", ({ payload }) => {
      if (isDisposed()) return;
      const tab = openBrowserPopup(payload);
      if (!tab) return;
      navigate(tab.route);
    }),
    listen<BrowserDownloadEvent>("misty://browser-download", ({ payload }) => {
      if (isDisposed()) return;
      const downloads = useBrowserDownloadsStore.getState();
      if (payload.state === "requested") {
        void downloads.refresh();
        return;
      }
      const tabId = browserTabIdForRuntime(payload.tabId);
      void downloads.refresh().then(() => {
        if (payload.success) {
          useBrowserDownloadsStore.getState().markFinished();

          return;
        }
        // Cancelling is the user's choice, not a failure worth reporting.
        const entry = useBrowserDownloadsStore
          .getState()
          .entries.find((item) => item.id === payload.downloadId);
        if (entry?.state === "cancelled" || !tabId) return;
        useBrowserRuntimeStore.getState().setError(tabId, payload.error || "The download failed.");
      });
    }),
    // Another device finished or removed a download in this Space.
    listen("misty:space-downloads-changed", () => {
      if (isDisposed()) return;
      void useBrowserDownloadsStore.getState().refresh();
    }),
  ];
}
