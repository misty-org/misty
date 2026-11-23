import { useBrowserRuntimeStore } from "./browser_runtime_store";
import type { BrowserBounds } from "./page_runtime_types";

export const visibleRuntimeIds = new Set<string>();
export const desiredVisibleRuntimeIds = new Set<string>();
export const lastBounds = new Map<string, string>();
export const browserWebviewSuspensions = new Set<string>();

export const browserRuntimeResumeEvent = "misty:browser-runtime-resume";

export const runtimeQueues = new Map<string, Promise<void>>();

export const adoptedPages = new Map<string, string>();
export const keepLiveRuntimeIds = new Set<string>();

export function setBrowserRuntimeKeepLive(runtimeId: string, keepLive: boolean): void {
  if (keepLive) keepLiveRuntimeIds.add(runtimeId);
  else keepLiveRuntimeIds.delete(runtimeId);
}

export const hideRequest = (id: string) => ({ id, keepLive: keepLiveRuntimeIds.has(id) });

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
