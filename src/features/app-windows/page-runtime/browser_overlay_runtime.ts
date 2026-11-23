import { invoke } from "@tauri-apps/api/core";
import { browserNoticeRadius, type BrowserNoticeRect } from "./browser_blocking_overlay";
import { checkBrowserOverlayTransparency } from "./browser_overlay_guard";
import { notifyBrowserSettled } from "./browser_switch_handoff";
import {
  browserRuntimeResumeEvent,
  browserWebviewSuspensions,
  desiredVisibleRuntimeIds,
  lastBounds,
} from "./browser_runtime_sets";

let browserOverlayQueue = Promise.resolve();
let browserPointerGestureActive = false;
let browserOverlayResumeGeneration = 0;
let browserOverlayActive = false;
let browserPointerTrackingEnabled: boolean | null = null;
let browserPointerTrackingQueue = Promise.resolve();
let browserNotices: BrowserNoticeRect[] = [];
let sentBrowserNotices = "";

const browserNoticeReason = "browser-notice";

export function isBrowserLayoutMoving(): boolean {
  return browserWebviewSuspensions.has("docking-layout");
}

export function setBrowserWebviewsSuspended(suspended: boolean, reason = "default"): void {
  const wasSuspended = browserWebviewSuspensions.size > 0;
  if (suspended) browserOverlayResumeGeneration += 1;
  if (suspended) browserWebviewSuspensions.add(reason);
  else if (browserWebviewSuspensions.delete(reason) && reason === "docking-layout")
    notifyBrowserSettled();
  const isSuspended = browserWebviewSuspensions.size > 0;
  if (isSuspended && !wasSuspended) {
    setBrowserOverlayActive(true);
  } else if (!isSuspended && wasSuspended && typeof window !== "undefined") {
    scheduleBrowserOverlayResume();
  }
  syncBrowserNotices();
}

function noticesCutThroughPages(): boolean {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform);
}

export function setBrowserNoticeRects(rects: BrowserNoticeRect[]): void {
  browserNotices = rects;
  if (noticesCutThroughPages()) syncBrowserNotices();
  else setBrowserWebviewsSuspended(rects.length > 0, browserNoticeReason);
}

function syncBrowserNotices(): void {
  const cutThrough = noticesCutThroughPages();
  if (!cutThrough && (typeof navigator === "undefined" || !/mac/i.test(navigator.platform))) return;
  const onlyNotices =
    browserWebviewSuspensions.size === 1 && browserWebviewSuspensions.has(browserNoticeReason);
  const rects = cutThrough || onlyNotices ? browserNotices : [];
  const sent = JSON.stringify(rects);
  if (sent === sentBrowserNotices) return;
  sentBrowserNotices = sent;
  browserOverlayQueue = browserOverlayQueue
    .catch(() => undefined)
    .then(() =>
      invoke<void>("browser_webviews_set_notice_rects", {
        rects,
        radius: browserNoticeRadius(),
      }).catch(() => undefined),
    );
}

export function reconcileBrowserOverlayState(): void {
  browserPointerGestureActive = false;
  browserOverlayResumeGeneration += 1;
  setBrowserOverlayActive(browserWebviewSuspensions.size > 0);
  sentBrowserNotices = "";
  syncBrowserNotices();
}

export function setBrowserPointerGestureActive(active: boolean): void {
  const wasActive = browserPointerGestureActive;
  browserPointerGestureActive = active;
  if (wasActive && !active && browserOverlayActive && browserWebviewSuspensions.size === 0) {
    scheduleBrowserOverlayResume();
  }
}

let browserPointerTrackingUsers = 0;

export function setBrowserPointerTrackingEnabled(requested: boolean): void {
  browserPointerTrackingUsers = Math.max(0, browserPointerTrackingUsers + (requested ? 1 : -1));
  const enabled = browserPointerTrackingUsers > 0;
  if (browserPointerTrackingEnabled === enabled) return;
  browserPointerTrackingEnabled = enabled;
  browserPointerTrackingQueue = browserPointerTrackingQueue
    .catch(() => undefined)
    .then(() =>
      invoke<void>("browser_webviews_set_pointer_tracking", { enabled }).catch(() => undefined),
    );
}

function overlayParksChildViews(): boolean {
  if (typeof navigator !== "undefined" && navigator.platform) {
    if (/mac/i.test(navigator.platform)) return false;
    if (/win/i.test(navigator.platform)) return false;
    if (/linux/i.test(navigator.platform)) return true;
  }
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    if (/macintosh|mac os x/i.test(navigator.userAgent)) return false;
    if (/windows/i.test(navigator.userAgent)) return false;
    if (/linux/i.test(navigator.userAgent)) return true;
  }
  if (typeof process !== "undefined" && process.platform) {
    if (process.platform === "darwin" || process.platform === "win32") return false;
    if (process.platform === "linux") return true;
  }
  return false;
}

function scheduleBrowserOverlayResume(): void {
  if (typeof window === "undefined" || browserPointerGestureActive || !browserOverlayActive) return;
  const generation = ++browserOverlayResumeGeneration;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (
        generation !== browserOverlayResumeGeneration ||
        browserPointerGestureActive ||
        browserWebviewSuspensions.size > 0
      ) {
        return;
      }
      setBrowserOverlayActive(false);
      void browserOverlayReady().then(() => {
        if (
          !browserOverlayActive &&
          browserWebviewSuspensions.size === 0 &&
          overlayParksChildViews()
        ) {
          desiredVisibleRuntimeIds.forEach((id) => lastBounds.delete(id));
          window.dispatchEvent(new Event(browserRuntimeResumeEvent));
        }
      });
    });
  });
}

function setBrowserOverlayActive(active: boolean): void {
  browserOverlayActive = active;
  if (active && typeof document !== "undefined") {
    document.documentElement.toggleAttribute("data-browser-overlay-active", true);
    checkBrowserOverlayTransparency();
  }
  browserOverlayQueue = browserOverlayQueue
    .catch(() => undefined)
    .then(async () => {
      if (browserOverlayActive !== active) return;
      await invoke<void>("browser_webviews_set_overlay_active", { active }).catch(() => undefined);
      if (!active && !browserOverlayActive && typeof document !== "undefined")
        document.documentElement.toggleAttribute("data-browser-overlay-active", false);
    });
}

export async function browserOverlayReady(): Promise<void> {
  await browserOverlayQueue;
}
