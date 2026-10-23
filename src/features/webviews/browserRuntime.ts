import { invalidatePagePreviews } from "./browserPagePreview";
import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import {
  browserRuntimeResumeEvent,
  createdRuntimeIds,
  lastBounds,
  runtimeQueues,
  runtimeTabIds,
  visibleRuntimeIds,
} from "./browserRuntimeSets";

// The native browser runtime: the tab pages' native webviews, placed, shown, hidden and closed
// through per-page queues. State lives in browserRuntimeSets.ts; the work is split by stage.
export { useBrowserRuntimeStore } from "./browserRuntimeStore";
export type {
  BrowserCompatibilityIssue,
  BrowserHistory,
  BrowserInspection,
  BrowserInteractiveControl,
  BrowserMistyPage,
  HistoryStep,
  PagePreview,
} from "./browserRuntimeTypes";

export {
  browserOverlayReady,
  isBrowserLayoutMoving,
  reconcileBrowserOverlayState,
  setBrowserPointerGestureActive,
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "./browserOverlayRuntime";
export {
  browserTabShowsInternalPage,
  setBrowserDownloadDirectory,
  setBrowserDownloadPrompt,
  setBrowserStatusBubbleEnabled,
  setBrowserTabShowsInternalPage,
} from "./browserHostSettings";
export {
  captureBrowserPagePreview,
  pagePreviewGeneration,
  prepareBrowserPagePreview,
  savePagePreview,
} from "./browserPagePreview";

export {
  browserRuntimeCreated,
  browserRuntimeId,
  browserScopeId,
  browserTabIdForRuntime,
  registerBrowserRuntime,
  setBrowserRuntimeKeepLive,
} from "./browserRuntimeSets";
export {
  hideBrowserWebview,
  navigateSyncedBrowserWebview,
  scheduleStrayPageSweep,
} from "./browserRuntimeVisibility";
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
  closeOrphanBrowserPages,
  onBrowserRuntimeClose,
  parkAllBrowserWebviews,
  switchBrowserPages,
} from "./browserRuntimeClose";

export { browserRuntimeResumeEvent };

/** Native handoff has closed the previous physical profile. Settle old runtime
 * work before invalidating cached handles; visible panes then reopen normally. */
export async function browserProfileChanged(
  stillCurrent: () => boolean = () => true,
): Promise<void> {
  invalidatePagePreviews();
  useBrowserRuntimeStore.setState({ previews: {} });
  await Promise.all([...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)));
  if (!stillCurrent()) return;
  createdRuntimeIds.clear();
  visibleRuntimeIds.clear();
  lastBounds.clear();
  useBrowserRuntimeStore.setState({ grants: {}, errors: {}, loading: {}, presented: {} });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(browserRuntimeResumeEvent));
}

export function browserRuntimeIdForTabId(tabId: string): string | null {
  for (const [runtimeId, candidate] of runtimeTabIds) {
    if (candidate === tabId) return runtimeId;
  }
  return null;
}

export function browserContentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Dispatched when the window's chrome color changes (its Space's color). */
export const windowChromeChangedEvent = "misty:window-chrome-changed";
