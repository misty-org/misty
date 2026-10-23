import { invoke } from "@tauri-apps/api/core";
import {
  adoptedPages,
  desiredVisibleRuntimeIds,
  enqueue,
  lastBounds,
  serializeBounds,
  setBrowserPagePresented,
  visibleRuntimeIds,
} from "./browserRuntimeSets";
import { cancelDeferredHide } from "./browserSwitchHandoff";
import { hideBrowserRuntime, presentReconciledPage } from "./browserRuntimeVisibility";
import type { BrowserBounds } from "./types";

// Adopted pages: an agent's pages beside its chat, kept in `adoptedPages` (browserRuntimeSets.ts).
/** The newest bounds for an adopted page whose placement is queued. */
const adoptedBounds = new Map<string, BrowserBounds>();

/** Shows an adopted page at `bounds`, as a tab's page is shown in its host. */
export function showAdoptedBrowserPage(
  runtimeId: string,
  presentedKey: string,
  bounds: BrowserBounds,
): Promise<void> {
  adoptedPages.set(runtimeId, presentedKey);
  // Parking leaves this page up, so showing it never calls off a park as a tab's sync does.
  desiredVisibleRuntimeIds.add(runtimeId);
  cancelDeferredHide(runtimeId);
  if (visibleRuntimeIds.has(runtimeId) && lastBounds.get(runtimeId) === serializeBounds(bounds))
    return Promise.resolve();
  // Only the newest measurement is applied, like a tab's sync.
  const queued = adoptedBounds.has(runtimeId);
  adoptedBounds.set(runtimeId, bounds);
  if (queued) return Promise.resolve();
  return enqueue(runtimeId, async () => {
    const latest = adoptedBounds.get(runtimeId);
    adoptedBounds.delete(runtimeId);
    if (!latest || !adoptedPages.has(runtimeId) || !desiredVisibleRuntimeIds.has(runtimeId)) return;
    // Coming on screen, it may still be parked for its first paint (a page just woken).
    const arriving = !visibleRuntimeIds.has(runtimeId);
    const exists = await invoke<boolean>("browser_webview_reconcile", {
      request: { id: runtimeId, nativeLiveResize: false, ...latest },
    });
    // Its owner closed it meanwhile, and only its owner opens it again.
    if (!exists) {
      visibleRuntimeIds.delete(runtimeId);
      lastBounds.delete(runtimeId);
      setBrowserPagePresented(runtimeId, false);
      return;
    }
    lastBounds.set(runtimeId, serializeBounds(latest));
    await presentReconciledPage(runtimeId, arriving);
  });
}

/** Takes an adopted page off screen; its owner keeps it live or closes it. */
export function hideAdoptedBrowserPage(runtimeId: string, graceMs = 0): Promise<void> {
  if (!adoptedPages.has(runtimeId)) return Promise.resolve();
  adoptedBounds.delete(runtimeId);
  // A positive grace keeps the page up until the page taking its place is presented (a tab switch
  // in the agent browser), as a browser tab's page is, so a switch never shows an empty frame.
  return hideBrowserRuntime(runtimeId, graceMs).then(() => {
    // Shown again while it was going.
    if (desiredVisibleRuntimeIds.has(runtimeId)) return;
    adoptedPages.delete(runtimeId);
    lastBounds.delete(runtimeId);
  });
}

/** Adopted pages wanted on screen now, which parking and switching leave in place. */
export function shownAdoptedPages(): string[] {
  return [...adoptedPages.keys()].filter((id) => desiredVisibleRuntimeIds.has(id));
}
