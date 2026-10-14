import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  browserPageTools,
  browserViewUrl,
  recordBrowserVisitTitle,
  useBrowserMediaStore,
  type BrowserMediaInfo,
} from "@/features/browser/library";
import { useWorkspaceStore } from "@/features/workspace";
import {
  browserRuntimeIdForTabId,
  browserTabIdForRuntime,
  browserTabShowsInternalPage,
  requestBrowserWebviewLayoutByRuntimeId,
  setBrowserRuntimeKeepLive,
  useBrowserRuntimeStore,
} from "./browserRuntime";
import { restorePageBackgrounds } from "./browserPageBackgrounds";

/** Brings a tab forward, wherever it is, the way a click on its page does, and Misty's window with it. */
/**
 * A video back from picture in picture can come home without its picture. Once its tab has been
 * shown and laid out again, the page is asked to repaint it, twice in case the first is early.
 */
function repaintReturnedVideo(runtimeId: string): void {
  for (const delay of [250, 900])
    window.setTimeout(() => {
      void browserPageTools.pictureInPicture(runtimeId, "refresh").catch(() => undefined);
    }, delay);
}

function showBrowserTab(tabId: string): void {
  if (hasTauriInternals())
    void getCurrentWindow()
      .unminimize()
      .then(() => getCurrentWindow().setFocus())
      .catch(() => undefined);
  if (useWorkspaceStore.getState().focusView(tabId))
    window.dispatchEvent(new CustomEvent("misty:focus-workspace-tab", { detail: { tabId } }));
}

interface BrowserPageEvent {
  id: string;
  url: string;
  /** `navigated`: the page changed its URL in place (History API or hash), loading nothing. */
  phase: "started" | "finished" | "navigated";
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
    // A newly created page stays parked until it paints; this brings it in.
    listen<{ id: string }>("misty://browser-reveal", ({ payload }) => {
      if (isDisposed()) return;
      requestBrowserWebviewLayoutByRuntimeId(payload.id);
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
        useBrowserMediaStore.getState().forgetPage(tabId);
      }
      useWorkspaceStore.getState().updateBrowserView(tabId, {
        url: payload.url,
      });
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
      audible: boolean;
    }>("misty://browser-media", ({ payload }) => {
      if (isDisposed()) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (tabId) useBrowserMediaStore.getState().setAudible(tabId, payload.audible);
    }),
    // A page pushes what it is playing the moment it changes. A video that floated and comes back
    // still playing was returned by the floating window's back-to-tab button: its tab comes forward.
    listen<{ id: string; info: BrowserMediaInfo }>("misty://browser-media-state", ({ payload }) => {
      if (isDisposed()) return;
      const tabId = browserTabIdForRuntime(payload.id);
      if (!tabId) return;
      const media = useBrowserMediaStore.getState();
      const wasFloating = Boolean(media.info[tabId]?.pictureInPicture);
      media.setInfo(tabId, payload.info);
      setBrowserRuntimeKeepLive(payload.id, payload.info.pictureInPicture === true);
      if (wasFloating && !payload.info.pictureInPicture) {
        if (!payload.info.paused) showBrowserTab(tabId);
        repaintReturnedVideo(payload.id);
      }
    }),
    // The floating window went away, and Misty was brought forward by the host. The page that
    // floated its video, as last reported, is shown, so the video returns to a tab you can see.
    listen("misty://pip-window-closed", () => {
      if (isDisposed()) return;
      const floating = Object.entries(useBrowserMediaStore.getState().info).find(
        ([, media]) => media.pictureInPicture,
      );
      if (floating) {
        showBrowserTab(floating[0]);
        const runtimeId = browserRuntimeIdForTabId(floating[0]);
        if (runtimeId) repaintReturnedVideo(runtimeId);
      }
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
