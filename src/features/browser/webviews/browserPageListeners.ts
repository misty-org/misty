import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import {
  browserTabIdForRuntime,
  requestBrowserWebviewLayoutByRuntimeId,
  useBrowserRuntimeStore,
} from "./browserRuntime";
import { restorePageBackgrounds } from "./browserPageBackgrounds";

interface BrowserPageEvent {
  id: string;
  url: string;
  /** `navigated`: the page changed its URL in place (History API or hash), loading nothing. */
  phase: "started" | "finished" | "navigated";
}
interface BrowserCompatibilityEvent {
  id: string;
  kind: "cloudflare_challenge" | "protected_media";
  url: string;
}

interface BrowserPageListenerOptions {
  isDisposed: () => boolean;
  pageBackgrounds: Map<string, string>;
}

/** Page lifecycle, background color, title, icon and compatibility events. */
export function listenBrowserPageEvents({
  isDisposed,
  pageBackgrounds,
}: BrowserPageListenerOptions): Promise<UnlistenFn>[] {
  return [
    listen<{
      id: string;
      color: string;
    }>("misty://browser-background", ({ payload }) => {
      if (
        isDisposed() ||
        typeof payload.color !== "string" ||
        !/^#[\da-f]{6}$/i.test(payload.color)
      )
        return;
      pageBackgrounds.set(payload.id, payload.color);
      restorePageBackgrounds(pageBackgrounds);
    }),
    // A page left full screen: its pane's bounds were ignored meanwhile, so measure them again.
    listen<{ id: string; active: boolean }>("misty://browser-fullscreen", ({ payload }) => {
      if (isDisposed() || payload.active) return;
      requestBrowserWebviewLayoutByRuntimeId(payload.id);
    }),
    // A newly created page stays parked until it paints; this brings it in.
    listen<{ id: string }>("misty://browser-reveal", ({ payload }) => {
      if (isDisposed()) return;
      requestBrowserWebviewLayoutByRuntimeId(payload.id);
    }),
    listen<BrowserPageEvent>("misty://browser-page", ({ payload }) => {
      if (isDisposed()) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (!tabId) return;
      if (payload.phase === "started") {
        pageBackgrounds.delete(payload.id);
        const host = document.querySelector<HTMLElement>(
          `[data-browser-workspace-tab="${CSS.escape(tabId)}"] [data-browser-page-host]`,
        );
        if (host) {
          delete host.dataset.mistyBrowserBackground;
          host.style.removeProperty("--browser-page-background");
        }
        useBrowserRuntimeStore.getState().setCompatibilityIssue(tabId, null);
        useBrowserRuntimeStore.getState().setLoading(tabId, true);
      }
      if (payload.phase === "navigated") {
        useBrowserRuntimeStore.getState().pushHistory(tabId, payload.url);
      }
      if (payload.phase === "finished") {
        useBrowserRuntimeStore.getState().setLoading(tabId, false);
        useBrowserRuntimeStore.getState().pushHistory(tabId, payload.url);
        // Page completion can race a layout transition that hid the native
        // child. Ask the geometry owner to reconcile bounds and visibility.
        requestBrowserWebviewLayoutByRuntimeId(payload.id);
      }
    }),
    listen<{
      id: string;
    }>("misty://browser-stopped", ({ payload }) => {
      if (isDisposed()) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (tabId) useBrowserRuntimeStore.getState().setLoading(tabId, false);
    }),
    listen<BrowserCompatibilityEvent>("misty://browser-compatibility", ({ payload }) => {
      if (
        isDisposed() ||
        (payload.kind !== "cloudflare_challenge" && payload.kind !== "protected_media") ||
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
  ];
}
