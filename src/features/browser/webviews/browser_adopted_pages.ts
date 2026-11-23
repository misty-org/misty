import { invoke } from "@tauri-apps/api/core";
import {
  adoptedPages,
  desiredVisibleRuntimeIds,
  enqueue,
  lastBounds,
  serializeBounds,
  setBrowserPagePresented,
  visibleRuntimeIds,
} from "@/features/app-windows";
import { cancelDeferredHide } from "@/features/app-windows";
import { hideBrowserRuntime, presentReconciledPage } from "./browser_runtime_visibility";
import type { BrowserBounds } from "@/features/app-windows";

const adoptedBounds = new Map<string, BrowserBounds>();

export function showAdoptedBrowserPage(
  runtimeId: string,
  presentedKey: string,
  bounds: BrowserBounds,
): Promise<void> {
  adoptedPages.set(runtimeId, presentedKey);
  desiredVisibleRuntimeIds.add(runtimeId);
  cancelDeferredHide(runtimeId);
  if (visibleRuntimeIds.has(runtimeId) && lastBounds.get(runtimeId) === serializeBounds(bounds))
    return Promise.resolve();
  const queued = adoptedBounds.has(runtimeId);
  adoptedBounds.set(runtimeId, bounds);
  if (queued) return Promise.resolve();
  return enqueue(runtimeId, async () => {
    const latest = adoptedBounds.get(runtimeId);
    adoptedBounds.delete(runtimeId);
    if (!latest || !adoptedPages.has(runtimeId) || !desiredVisibleRuntimeIds.has(runtimeId)) return;
    const arriving = !visibleRuntimeIds.has(runtimeId);
    const exists = await invoke<boolean>("browser_webview_reconcile", {
      request: { id: runtimeId, nativeLiveResize: false, ...latest },
    });
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

export function hideAdoptedBrowserPage(runtimeId: string, graceMs = 0): Promise<void> {
  if (!adoptedPages.has(runtimeId)) return Promise.resolve();
  adoptedBounds.delete(runtimeId);
  return hideBrowserRuntime(runtimeId, graceMs).then(() => {
    if (desiredVisibleRuntimeIds.has(runtimeId)) return;
    adoptedPages.delete(runtimeId);
    lastBounds.delete(runtimeId);
  });
}
