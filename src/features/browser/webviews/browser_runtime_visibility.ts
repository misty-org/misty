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

const awaitingFirstPaint = new Set<string>();

export async function presentReconciledPage(id: string, createdNow: boolean): Promise<void> {
  markBrowserPerf(id, "reconciled");
  if (!desiredVisibleRuntimeIds.has(id)) {
    visibleRuntimeIds.delete(id);
    setBrowserPagePresented(id, false);
    await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
    return;
  }
  visibleRuntimeIds.add(id);
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

export function hideBrowserRuntime(id: string, graceMs = 0): Promise<void> {
  desiredVisibleRuntimeIds.delete(id);
  visibleRuntimeIds.delete(id);
  if (graceMs > 0) {
    markBrowserPerf(id, "old page waiting to hand off", true);
    return new Promise<void>((resolve) => {
      deferHideUntilHandoff(id, () => {
        if (desiredVisibleRuntimeIds.has(id)) return resolve();
        void enqueue(id, async () => {
          if (desiredVisibleRuntimeIds.has(id)) return;
          setBrowserPagePresented(id, false);
          await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
        }).then(resolve);
      });
    });
  }
  cancelDeferredHide(id);
  setBrowserPagePresented(id, false);
  return enqueue(id, async () => {
    await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
  });
}
