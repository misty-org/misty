import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import type { BrowserBounds } from "./pageRuntimeTypes";

/** Page state the runtime modules and its overlay guard share (browserRuntime.ts). */
export const visibleRuntimeIds = new Set<string>();
export const desiredVisibleRuntimeIds = new Set<string>();
export const lastBounds = new Map<string, string>();
export const browserWebviewSuspensions = new Set<string>();

export const browserRuntimeResumeEvent = "misty:browser-runtime-resume";

export const runtimeQueues = new Map<string, Promise<void>>();

/**
 * Pages another owner creates and closes, shown through this runtime all the same: an agent's
 * pages beside its chat (agentTabs.ts). Each has its runtime id and the key its presented state
 * is kept under. This runtime never creates them, and they are not tabs.
 */
export const adoptedPages = new Map<string, string>();
/** Pages floating a video in picture in picture: parked out of sight when their tab leaves, not
 * hidden, so the floating window's back-to-tab button still has a page to return to. */
export const keepLiveRuntimeIds = new Set<string>();

export function setBrowserRuntimeKeepLive(runtimeId: string, keepLive: boolean): void {
  if (keepLive) keepLiveRuntimeIds.add(runtimeId);
  else keepLiveRuntimeIds.delete(runtimeId);
}

export const hideRequest = (id: string) => ({ id, keepLive: keepLiveRuntimeIds.has(id) });

/** Whether the page is on screen in its host; until it is, the host paints a fill. */
export function setBrowserPagePresented(runtimeId: string, presented: boolean): void {
  const key = adoptedPages.get(runtimeId);
  if (key) useBrowserRuntimeStore.getState().setPresented(key, presented);
}

export function serializeBounds(bounds: BrowserBounds, nativeLiveResize = false): string {
  return [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    nativeLiveResize ? 1 : 0,
    ...(bounds.cornerRadii ?? []),
  ]
    .map((value) => String(Math.round(value * 2) / 2))
    .concat(bounds.cornerColor ? [bounds.cornerColor] : [])
    .join(":");
}

export function enqueue(id: string, operation: () => Promise<void>): Promise<void> {
  const pending = runtimeQueues.get(id) ?? Promise.resolve();
  const next = pending.catch(() => undefined).then(operation);
  runtimeQueues.set(id, next);
  const cleanup = () => {
    if (runtimeQueues.get(id) === next) runtimeQueues.delete(id);
  };
  void next.then(cleanup, cleanup);
  return next;
}
