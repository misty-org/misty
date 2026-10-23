import { invoke } from "@tauri-apps/api/core";
import { checkBrowserOverlayTransparency } from "./browserOverlayGuard";
import { notifyBrowserSettled } from "./browserSwitchHandoff";
import {
  browserRuntimeResumeEvent,
  browserWebviewSuspensions,
  desiredVisibleRuntimeIds,
  lastBounds,
} from "./browserRuntimeSets";

let browserOverlayQueue = Promise.resolve();
let browserPointerGestureActive = false;
let browserOverlayResumeGeneration = 0;
let browserOverlayActive = false;
let browserPointerTrackingEnabled: boolean | null = null;
let browserPointerTrackingQueue = Promise.resolve();

/** Whether a layout move holds the pages: they keep their place until it has settled. */
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
}

/** Reassert renderer ownership after a host reload or return to the window.
 * Native children can outlive the JavaScript module that last raised an overlay. */
export function reconcileBrowserOverlayState(): void {
  browserPointerGestureActive = false;
  browserOverlayResumeGeneration += 1;
  setBrowserOverlayActive(browserWebviewSuspensions.size > 0);
}

export function setBrowserPointerGestureActive(active: boolean): void {
  const wasActive = browserPointerGestureActive;
  browserPointerGestureActive = active;
  if (wasActive && !active && browserOverlayActive && browserWebviewSuspensions.size === 0) {
    scheduleBrowserOverlayResume();
  }
}

/** Callers pair each `true` with a later `false`; tracking stays on while any of them wants it. */
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
  // Keep the renderer above the page through the closing pointer sequence and
  // the portal's final frame, then return the page to its normal sibling order.
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
          // WebKitGTK (Linux) parks child views while renderer popovers are
          // open. Invalidate the cached frames so each desired page is shown
          // again even when its geometry did not change. On macOS and Windows,
          // native views stay alive in their sibling z-order.
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
      // While the page is still below the renderer it shows through the transparent host, and
      // painting the host's fill sooner covers it with a flat rectangle for a frame. Only once
      // the page is back above the renderer does the host get its fill again.
      if (!active && !browserOverlayActive && typeof document !== "undefined")
        document.documentElement.toggleAttribute("data-browser-overlay-active", false);
    });
}

export async function browserOverlayReady(): Promise<void> {
  await browserOverlayQueue;
}
