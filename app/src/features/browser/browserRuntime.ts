import type { BrowserBounds, BrowserTheme } from "./types";
import type { ActiveBrowserAgentGrant } from "./browserAgentAccess";
import { revokeBrowserAgentGrant } from "./browserAgentAccess";
import type { WorkspaceTab } from "@/features/workspace";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { browserUserAgent } from "./browserUserAgent";

interface BrowserHistory {
  entries: string[];
  index: number;
}

interface BrowserRuntimeUiState {
  grants: Record<string, ActiveBrowserAgentGrant[]>;
  histories: Record<string, BrowserHistory>;
  errors: Record<string, string | null>;
  notices: Record<string, string | null>;
  setGrants: (tabId: string, grants: ActiveBrowserAgentGrant[]) => void;
  ensureHistory: (tabId: string, url: string) => void;
  pushHistory: (tabId: string, url: string) => void;
  moveHistory: (tabId: string, direction: -1 | 1) => string | null;
  setError: (tabId: string, error: string | null) => void;
  setNotice: (tabId: string, notice: string | null) => void;
  removeTab: (tabId: string) => void;
}

export const useBrowserRuntimeStore = create<BrowserRuntimeUiState>((set, get) => ({
  grants: {},
  histories: {},
  errors: {},
  notices: {},
  setGrants: (tabId, grants) => set((state) => ({ grants: { ...state.grants, [tabId]: grants } })),
  ensureHistory: (tabId, url) =>
    set((state) =>
      state.histories[tabId]
        ? state
        : { histories: { ...state.histories, [tabId]: { entries: [url], index: 0 } } },
    ),
  pushHistory: (tabId, url) =>
    set((state) => {
      const current = state.histories[tabId] ?? { entries: [url], index: 0 };
      if (current.entries[current.index] === url) return state;
      const existingIndex = current.entries.lastIndexOf(url);
      const next =
        existingIndex >= 0 && Math.abs(existingIndex - current.index) === 1
          ? { ...current, index: existingIndex }
          : {
              entries: [...current.entries.slice(0, current.index + 1), url],
              index: current.index + 1,
            };
      return { histories: { ...state.histories, [tabId]: next } };
    }),
  moveHistory: (tabId, direction) => {
    const current = get().histories[tabId];
    if (!current) return null;
    const index = current.index + direction;
    if (index < 0 || index >= current.entries.length) return null;
    set((state) => ({
      histories: { ...state.histories, [tabId]: { ...current, index } },
    }));
    return current.entries[index] ?? null;
  },
  setError: (tabId, error) => set((state) => ({ errors: { ...state.errors, [tabId]: error } })),
  setNotice: (tabId, notice) =>
    set((state) => ({ notices: { ...state.notices, [tabId]: notice } })),
  removeTab: (tabId) =>
    set((state) => {
      const grants = { ...state.grants };
      const histories = { ...state.histories };
      const errors = { ...state.errors };
      const notices = { ...state.notices };
      delete grants[tabId];
      delete histories[tabId];
      delete errors[tabId];
      delete notices[tabId];
      return { grants, histories, errors, notices };
    }),
}));

const createdRuntimeIds = new Set<string>();
const visibleRuntimeIds = new Set<string>();
const lastBounds = new Map<string, string>();
const requestedBounds = new Map<string, string>();
const runtimeTabIds = new Map<string, string>();
const runtimeQueues = new Map<string, Promise<void>>();
const browserWebviewSuspensions = new Set<string>();
let browserOverlayQueue = Promise.resolve();

export const browserRuntimeResumeEvent = "misty:browser-runtime-resume";

type BrowserRuntimeTab = Pick<WorkspaceTab, "id" | "instanceKey">;

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

export function requestBrowserWebviewLayout(tab: BrowserRuntimeTab): void {
  lastBounds.delete(registerBrowserRuntime(tab));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(browserRuntimeResumeEvent));
  }
}

export function requestBrowserWebviewLayoutByRuntimeId(runtimeId: string): void {
  lastBounds.delete(runtimeId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(browserRuntimeResumeEvent));
  }
}

export function syncBrowserWebview(input: {
  tab: WorkspaceTab;
  url: string;
  bounds: BrowserBounds;
  theme: BrowserTheme;
}): Promise<void> {
  const id = registerBrowserRuntime(input.tab);
  const boundsKey = serializeBounds(input.bounds);
  const pending = runtimeQueues.get(id);
  if (pending && requestedBounds.get(id) === boundsKey) return pending;
  requestedBounds.set(id, boundsKey);
  return enqueue(id, async () => {
    if (!createdRuntimeIds.has(id)) {
      await invoke("browser_webview_create", {
        request: {
          id,
          url: input.url,
          scopeId: browserScopeId(input.tab),
          theme: input.theme,
          userAgent: browserUserAgent(),
          ...input.bounds,
        },
      });
      createdRuntimeIds.add(id);
    }
    // Frontend caches can outlive a crashed, detached, or hot-reloaded native
    // child. Reconcile against native state on every geometry pass. A missing
    // view is recreated immediately instead of leaving a permanently blank
    // browser surface.
    let exists = await invoke<boolean>("browser_webview_reconcile", {
      request: { id, ...input.bounds },
    });
    if (!exists) {
      createdRuntimeIds.delete(id);
      visibleRuntimeIds.delete(id);
      await invoke("browser_webview_create", {
        request: {
          id,
          url: input.url,
          scopeId: browserScopeId(input.tab),
          theme: input.theme,
          userAgent: browserUserAgent(),
          ...input.bounds,
        },
      });
      createdRuntimeIds.add(id);
      exists = await invoke<boolean>("browser_webview_reconcile", {
        request: { id, ...input.bounds },
      });
      if (!exists) throw new Error("Browser webview could not be attached.");
    }
    lastBounds.set(id, boundsKey);
    visibleRuntimeIds.add(id);
  });
}

export function setBrowserWebviewsSuspended(suspended: boolean, reason = "default"): void {
  const wasSuspended = browserWebviewSuspensions.size > 0;
  if (suspended) browserWebviewSuspensions.add(reason);
  else browserWebviewSuspensions.delete(reason);
  const isSuspended = browserWebviewSuspensions.size > 0;
  if (isSuspended && !wasSuspended) {
    setBrowserOverlayActive(true);
  } else if (!isSuspended && wasSuspended && typeof window !== "undefined") {
    setBrowserOverlayActive(false);
    window.dispatchEvent(new Event(browserRuntimeResumeEvent));
  }
}

function setBrowserOverlayActive(active: boolean): void {
  if (typeof document !== "undefined") {
    document.documentElement.toggleAttribute("data-browser-overlay-active", active);
  }
  browserOverlayQueue = browserOverlayQueue
    .catch(() => undefined)
    .then(() =>
      invoke<void>("browser_webviews_set_overlay_active", { active }).catch(() => undefined),
    );
}

export function hideBrowserWebview(tab: BrowserRuntimeTab): Promise<void> {
  const id = registerBrowserRuntime(tab);
  if (!createdRuntimeIds.has(id) || !visibleRuntimeIds.has(id)) return Promise.resolve();
  visibleRuntimeIds.delete(id);
  return enqueue(id, async () => {
    await invoke("browser_webview_hide", { request: { id } }).catch(() => undefined);
  });
}

export async function closeBrowserRuntime(tab: WorkspaceTab): Promise<void> {
  const id = registerBrowserRuntime(tab);
  const grants = useBrowserRuntimeStore.getState().grants[tab.id] ?? [];
  await Promise.allSettled(grants.map((grant) => revokeBrowserAgentGrant(id, grant)));
  await enqueue(id, async () => {
    if (createdRuntimeIds.has(id)) {
      await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
    }
    createdRuntimeIds.delete(id);
    visibleRuntimeIds.delete(id);
    lastBounds.delete(id);
    requestedBounds.delete(id);
    runtimeTabIds.delete(id);
    useBrowserRuntimeStore.getState().removeTab(tab.id);
  });
}

export function hideAllBrowserWebviews(): Promise<void[]> {
  const trackedHides = Promise.all(
    [...visibleRuntimeIds].map((id) => {
      visibleRuntimeIds.delete(id);
      return enqueue(id, async () => {
        await invoke("browser_webview_hide", { request: { id } }).catch(() => undefined);
      });
    }),
  );
  // A native child can outlive frontend module state after a renderer
  // refresh. Always hide every native browser child so overlays do not depend
  // on visibleRuntimeIds being current.
  return Promise.all([
    trackedHides.then(() => undefined),
    invoke<void>("browser_webviews_hide_all").catch(() => undefined),
  ]);
}

function serializeBounds(bounds: BrowserBounds): string {
  return [bounds.x, bounds.y, bounds.width, bounds.height]
    .map((value) => Math.round(value * 2) / 2)
    .join(":");
}

function enqueue(id: string, operation: () => Promise<void>): Promise<void> {
  const pending = runtimeQueues.get(id) ?? Promise.resolve();
  const next = pending.catch(() => undefined).then(operation);
  runtimeQueues.set(id, next);
  const cleanup = () => {
    if (runtimeQueues.get(id) === next) runtimeQueues.delete(id);
  };
  void next.then(cleanup, cleanup);
  return next;
}
