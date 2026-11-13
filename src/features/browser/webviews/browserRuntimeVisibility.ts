import { invoke } from "@tauri-apps/api/core";
import {
  desiredVisibleRuntimeIds,
  enqueue,
  hideRequest,
  setBrowserPagePresented,
  visibleRuntimeIds,
} from "@/features/app-windows";
import {
  cancelDeferredHide,
  completeHandoff,
  deferHideUntilHandoff,
  hasPendingHandoff,
  markBrowserPerf,
} from "@/features/app-windows";

/** New pages the host keeps parked until their first paint (Windows). */
const awaitingFirstPaint = new Set<string>();

/**
 * Brings a reconciled page on screen, unless its host stopped wanting it meanwhile. A page still
 * parked for its first paint is not presented yet, and its host keeps its fill until it is.
 */
export async function presentReconciledPage(id: string, createdNow: boolean): Promise<void> {
  markBrowserPerf(id, "reconciled");
  // The Browser surface can unmount while native creation or reconciliation
  // is still in flight. Honor the latest desired visibility before exposing
  // the child, otherwise that late completion can cover Home or another tool.
  if (!desiredVisibleRuntimeIds.has(id)) {
    visibleRuntimeIds.delete(id);
    setBrowserPagePresented(id, false);
    await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
    return;
  }
  visibleRuntimeIds.add(id);
  // A new page can exist yet still be parked until its first paint. The page
  // it replaces must stay up until it is really on screen, and its host keeps
  // its fill until then (its reveal comes back through this path).
  const held =
    createdNow || awaitingFirstPaint.has(id) || hasPendingHandoff()
      ? await invoke<boolean>("browser_webview_held", { request: { id } }).catch(() => false)
      : false;
  if (held) awaitingFirstPaint.add(id);
  else awaitingFirstPaint.delete(id);
  markBrowserPerf(id, held ? "held for first paint" : "presented");
  setBrowserPagePresented(id, !held);
  if (!held) completeHandoff(id);
}

/**
 * Takes a page off screen. A positive `graceMs` keeps it there while another page is about to
 * take its place, so a switch never shows an empty frame between them. The old page leaves as
 * soon as the new one is presented.
 */
export function hideBrowserRuntime(id: string, graceMs = 0): Promise<void> {
  desiredVisibleRuntimeIds.delete(id);
  visibleRuntimeIds.delete(id);
  if (graceMs > 0) {
    // The old page stays until the next one is presented; the fallback in
    // browserSwitchHandoff covers a page that never arrives.
    markBrowserPerf(id, "old page waiting to hand off", true);
    return new Promise<void>((resolve) => {
      deferHideUntilHandoff(id, () => {
        // The tab was shown again, or its runtime closed, while waiting.
        if (desiredVisibleRuntimeIds.has(id)) return resolve();
        void enqueue(id, async () => {
          if (desiredVisibleRuntimeIds.has(id)) return;
          // It stays presented until the next page is, so the window never turns opaque between.
          setBrowserPagePresented(id, false);
          await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
        }).then(resolve);
      });
    });
  }
  cancelDeferredHide(id);
  // The fill goes in under the page before the page leaves, never after.
  setBrowserPagePresented(id, false);
  // Always enqueue the hide. A create/reconcile operation may still be in
  // flight even when the frontend has not marked this runtime visible yet.
  // The native command safely no-ops when no child exists.
  return enqueue(id, async () => {
    await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
  });
}
