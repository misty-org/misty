import type { WorkspaceView } from "@/features/workspace";
import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import type { BrowserBounds, BrowserTheme } from "./types";

/** Page state the runtime modules, its overlay guard and previews share (browserRuntime.ts). */
export const visibleRuntimeIds = new Set<string>();
export const desiredVisibleRuntimeIds = new Set<string>();
export const lastBounds = new Map<string, string>();
export const browserWebviewSuspensions = new Set<string>();

export const browserRuntimeResumeEvent = "misty:browser-runtime-resume";

export type BrowserRuntimeTab = Pick<WorkspaceView, "id" | "instanceKey">;

export type BrowserSyncInput = {
  originSpaceId?: string;
  /** Opaque host-issued context used by agent browser grants. */
  scopeId?: string;
  /** Host-derived account/deployment profile for native browser views. */
  profileId?: string;
  providerId?: string;
  profileProviderId?: string;
  tab: WorkspaceView;
  url: string;
  bounds: BrowserBounds;
  theme: BrowserTheme;
  nativeLiveResize?: boolean;
};

export interface BrowserSyncState {
  latest: BrowserSyncInput | null;
  running: boolean;
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
}

export const createdRuntimeIds = new Set<string>();
export const runtimeTabIds = new Map<string, string>();
export const runtimeQueues = new Map<string, Promise<void>>();
export const browserSyncStates = new Map<string, BrowserSyncState>();
/** Runtimes whose tab was closed, with a check for whether it is still gone. */
export const closedRuntimes = new Map<string, () => boolean>();
/** Bumped by every sync and park, so a park that a newer sync overtook gives up. */
export const parkGeneration = { current: 0 };

/**
 * Pages another owner creates and closes, shown through this runtime all the same: an agent's
 * pages beside its chat (agentTabs.ts). They take the tab pages' placement, presented state,
 * first-paint hold, parking and switching, under their own runtime id, with the key their
 * presented state is kept under. This runtime never creates them, and they are not tabs: their
 * page events never reach the person's tabs or history.
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

export function browserRuntimeId(tab: BrowserRuntimeTab): string {
  return `tab-${tab.instanceKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)}`;
}

export function browserScopeId(tab: BrowserRuntimeTab): string {
  return `scope-${browserRuntimeId(tab)}`;
}

export function browserTabIdForRuntime(runtimeId: string): string | null {
  return runtimeTabIds.get(runtimeId) ?? null;
}

export function registerBrowserRuntime(tab: BrowserRuntimeTab): string {
  const runtimeId = browserRuntimeId(tab);
  runtimeTabIds.set(runtimeId, tab.id);
  return runtimeId;
}

export function browserRuntimeCreated(tab: BrowserRuntimeTab): boolean {
  return createdRuntimeIds.has(browserRuntimeId(tab));
}

/** Whether the tab's page is on screen in its host; until it is, the host paints a fill. */
export function setBrowserPagePresented(runtimeId: string, presented: boolean): void {
  const tabId = runtimeTabIds.get(runtimeId) ?? adoptedPages.get(runtimeId);
  if (tabId) useBrowserRuntimeStore.getState().setPresented(tabId, presented);
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
