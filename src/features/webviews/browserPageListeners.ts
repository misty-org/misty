import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import {
  browserViewUrl,
  recordBrowserVisitTitle,
  useBrowserMediaStore,
} from "@/features/browser/library";
import { useWorkspaceStore } from "@/features/workspace";
import {
  browserTabIdForRuntime,
  browserTabShowsInternalPage,
  requestBrowserWebviewLayoutByRuntimeId,
  useBrowserRuntimeStore,
} from "./browserRuntime";
import { restorePageBackgrounds } from "./browserPageBackgrounds";

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
  kind: "cloudflare_challenge" | "protected_media";
  url: string;
}

interface BrowserPageListenerOptions {
  isDisposed: () => boolean;
  pageBackgrounds: Map<string, string>;
}

/** Page lifecycle, background color, media, title, icon and compatibility events. */
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
    listen<BrowserPageEvent>("misty://browser-page", ({ payload }) => {
      if (isDisposed()) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (!tabId) return;
      if (browserTabShowsInternalPage(tabId)) return;
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
      useWorkspaceStore.getState().updateBrowserView(tabId, {
        url: payload.url,
      });
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
      audible: boolean;
    }>("misty://browser-media", ({ payload }) => {
      if (isDisposed()) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (tabId) useBrowserMediaStore.getState().setAudible(tabId, payload.audible);
    }),
    listen<{
      id: string;
    }>("misty://browser-stopped", ({ payload }) => {
      if (isDisposed()) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (tabId) useBrowserRuntimeStore.getState().setLoading(tabId, false);
    }),
    listen<BrowserTitleEvent>("misty://browser-title", ({ payload }) => {
      if (isDisposed() || !payload.title.trim()) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (tabId && !browserTabShowsInternalPage(tabId)) {
        useWorkspaceStore.getState().updateBrowserView(tabId, {
          title: payload.title.trim(),
        });
        const url = browserViewUrl(tabId);
        if (url) recordBrowserVisitTitle(tabId, url, payload.title.trim());
      }
    }),
    listen<BrowserFaviconEvent>("misty://browser-favicon", ({ payload }) => {
      if (isDisposed() || !/^https?:\/\//i.test(payload.url)) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (tabId && !browserTabShowsInternalPage(tabId)) {
        useWorkspaceStore.getState().updateBrowserView(tabId, {
          faviconUrl: payload.url,
        });
      }
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
