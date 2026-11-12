import { browserRuntimeResumeEvent, runtimeTabIds } from "@/features/app-windows";

// The native browser runtime: the tab pages' native webviews, placed, shown, hidden and closed
// through per-page queues. State lives in browserRuntimeSets.ts; the work is split by stage.
export { useBrowserRuntimeStore } from "@/features/app-windows";
export type { BrowserHistory, BrowserInspection, BrowserMistyPage } from "@/features/app-windows";

export {
  browserOverlayReady,
  isBrowserLayoutMoving,
  reconcileBrowserOverlayState,
  setBrowserNoticeRects,
  setBrowserPointerGestureActive,
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "@/features/app-windows";

export {
  browserRuntimeCreated,
  browserRuntimeId,
  browserScopeId,
  browserTabIdForRuntime,
  setBrowserRuntimeKeepLive,
} from "@/features/app-windows";
export { hideBrowserWebview, scheduleStrayPageSweep } from "./browserRuntimeVisibility";
export {
  isBrowserRuntimeCreated,
  prewarmBrowserWebview,
  requestBrowserWebviewLayout,
  requestBrowserWebviewLayoutByRuntimeId,
  syncBrowserWebview,
} from "./browserRuntimeSync";
export { hideAdoptedBrowserPage, showAdoptedBrowserPage } from "./browserAdoptedPages";
export {
  closeBrowserRuntime,
  closeOrphanAgentPages,
  closeOrphanBrowserPages,
  onBrowserRuntimeClose,
  parkAllBrowserWebviews,
  switchBrowserPages,
} from "./browserRuntimeClose";

export { browserRuntimeResumeEvent };

export function browserRuntimeIdForTabId(tabId: string): string | null {
  for (const [runtimeId, candidate] of runtimeTabIds) {
    if (candidate === tabId) return runtimeId;
  }
  return null;
}

/** Dispatched when the window's chrome color changes (its profile's color). */
export const windowChromeChangedEvent = "misty:window-chrome-changed";
