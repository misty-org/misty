import type { BrowserBounds, BrowserTheme } from "./types";
import type { ActiveBrowserAgentGrant } from "./browserAgentAccess";
import { revokeBrowserAgentGrant } from "./browserAgentAccess";
import type { WorkspaceTab } from "@/features/workspace";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

interface BrowserHistory {
  entries: string[];
  index: number;
}

export interface BrowserCompatibilityIssue {
  kind: "cloudflare_challenge";
  url: string;
}

interface BrowserRuntimeUiState {
  grants: Record<string, ActiveBrowserAgentGrant[]>;
  histories: Record<string, BrowserHistory>;
  errors: Record<string, string | null>;
  notices: Record<string, string | null>;
  compatibilityIssues: Record<string, BrowserCompatibilityIssue | null>;
  loading: Record<string, boolean>;
  setGrants: (tabId: string, grants: ActiveBrowserAgentGrant[]) => void;
  ensureHistory: (tabId: string, url: string) => void;
  pushHistory: (tabId: string, url: string) => void;
  moveHistory: (tabId: string, direction: -1 | 1) => string | null;
  setError: (tabId: string, error: string | null) => void;
  setNotice: (tabId: string, notice: string | null) => void;
  setCompatibilityIssue: (tabId: string, issue: BrowserCompatibilityIssue | null) => void;
  setLoading: (tabId: string, loading: boolean) => void;
  removeTab: (tabId: string) => void;
}

export const useBrowserRuntimeStore = create<BrowserRuntimeUiState>((set, get) => ({
  grants: {},
  histories: {},
  errors: {},
  notices: {},
  compatibilityIssues: {},
  loading: {},
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
  setError: (tabId, error) =>
    set((state) => ({
      errors: { ...state.errors, [tabId]: error },
      ...(error ? { loading: { ...state.loading, [tabId]: false } } : {}),
    })),
  setNotice: (tabId, notice) =>
    set((state) => ({ notices: { ...state.notices, [tabId]: notice } })),
  setCompatibilityIssue: (tabId, issue) =>
    set((state) => ({
      compatibilityIssues: { ...state.compatibilityIssues, [tabId]: issue },
    })),
  setLoading: (tabId, loading) =>
    set((state) => ({ loading: { ...state.loading, [tabId]: loading } })),
  removeTab: (tabId) =>
    set((state) => {
      const grants = { ...state.grants };
      const histories = { ...state.histories };
      const errors = { ...state.errors };
      const notices = { ...state.notices };
      const compatibilityIssues = { ...state.compatibilityIssues };
      const loading = { ...state.loading };
      delete grants[tabId];
      delete histories[tabId];
      delete errors[tabId];
      delete notices[tabId];
      delete compatibilityIssues[tabId];
      delete loading[tabId];
      return { grants, histories, errors, notices, compatibilityIssues, loading };
    }),
}));

const createdRuntimeIds = new Set<string>();
const visibleRuntimeIds = new Set<string>();
const desiredVisibleRuntimeIds = new Set<string>();
const lastBounds = new Map<string, string>();
const runtimeTabIds = new Map<string, string>();
const runtimeQueues = new Map<string, Promise<void>>();
const browserSyncStates = new Map<string, BrowserSyncState>();
const browserWebviewSuspensions = new Set<string>();
let browserParkGeneration = 0;
let browserOverlayQueue = Promise.resolve();
let browserPointerGestureActive = false;
let browserOverlayResumeGeneration = 0;
let browserOverlayActive = false;
let browserPointerTrackingEnabled: boolean | null = null;
let browserPointerTrackingQueue = Promise.resolve();

export const browserRuntimeResumeEvent = "misty:browser-runtime-resume";

type BrowserRuntimeTab = Pick<WorkspaceTab, "id" | "instanceKey">;
type BrowserSyncInput = {
  tab: WorkspaceTab;
  url: string;
  bounds: BrowserBounds;
  theme: BrowserTheme;
  nativeLiveResize?: boolean;
};

interface BrowserSyncState {
  latest: BrowserSyncInput | null;
  running: boolean;
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
}

export function browserRuntimeId(tab: BrowserRuntimeTab): string {
  return `tab-${tab.instanceKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)}`;
}

export function browserScopeId(tab: BrowserRuntimeTab): string {
  return `scope-${browserRuntimeId(tab)}`;
}

export function browserTabIdForRuntime(runtimeId: string): string | null {
  return runtimeTabIds.get(runtimeId) ?? null;
}

export function browserRuntimeIdForTabId(tabId: string): string | null {
  for (const [runtimeId, candidate] of runtimeTabIds) {
    if (candidate === tabId) return runtimeId;
  }
  return null;
}

export function setNativeBrowserCompanionState(request: {
  targetId: string;
  visible: boolean;
  phase: string;
  name: string;
  label: string;
  speech?: string;
  captureAttached?: boolean;
  suggestions: Array<{ id: string; label: string }>;
}): Promise<void> {
  return invoke<void>("browser_webviews_set_companion", { request }).catch(() => undefined);
}

export function captureNativeBrowserRegion(
  id: string,
  region: { x: number; y: number; width: number; height: number },
): Promise<{ dataUrl: string; width: number; height: number }> {
  return invoke("browser_webview_capture_region", { request: { id, ...region } });
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

export function syncBrowserWebview(input: BrowserSyncInput): Promise<void> {
  const id = registerBrowserRuntime(input.tab);
  browserParkGeneration += 1;
  desiredVisibleRuntimeIds.add(id);
  const boundsKey = serializeBounds(input.bounds, input.nativeLiveResize);
  const existingState = browserSyncStates.get(id);
  if (
    !existingState &&
    createdRuntimeIds.has(id) &&
    visibleRuntimeIds.has(id) &&
    lastBounds.get(id) === boundsKey
  ) {
    return Promise.resolve();
  }
  const state = existingState ?? { latest: null, running: false, waiters: [] };
  state.latest = input;
  browserSyncStates.set(id, state);
  const result = new Promise<void>((resolve, reject) => {
    state.waiters.push({ resolve, reject });
  });
  if (!state.running) void flushBrowserSync(id, state);
  return result;
}

async function flushBrowserSync(id: string, state: BrowserSyncState): Promise<void> {
  state.running = true;
  try {
    // Live window resizing can produce geometry faster than native IPC can
    // apply it. Keep only the newest measurement while one update is in
    // flight, otherwise stale frames queue up and the webview trails the app.
    while (state.latest) {
      const input = state.latest;
      state.latest = null;
      await enqueue(id, () => applyBrowserSync(id, input));
    }
    state.waiters.splice(0).forEach(({ resolve }) => resolve());
  } catch (error) {
    state.latest = null;
    state.waiters.splice(0).forEach(({ reject }) => reject(error));
  } finally {
    state.running = false;
    if (browserSyncStates.get(id) === state) browserSyncStates.delete(id);
  }
}

async function applyBrowserSync(id: string, input: BrowserSyncInput): Promise<void> {
  const boundsKey = serializeBounds(input.bounds, input.nativeLiveResize);
  if (!createdRuntimeIds.has(id)) {
    await invoke("browser_webview_create", {
      request: {
        id,
        url: input.url,
        scopeId: browserScopeId(input.tab),
        theme: input.theme,
        nativeLiveResize: Boolean(input.nativeLiveResize),
        ...input.bounds,
      },
    });
    createdRuntimeIds.add(id);
  }
  // Frontend caches can outlive a crashed, detached, or hot-reloaded native
  // child. Reconcile after creation, a real bounds change, or an explicit
  // layout invalidation. Avoid no-op native frame writes: on macOS they
  // rebuild WKWebView tracking areas and make cursor ownership flicker.
  let exists = await invoke<boolean>("browser_webview_reconcile", {
    request: { id, nativeLiveResize: Boolean(input.nativeLiveResize), ...input.bounds },
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
        nativeLiveResize: Boolean(input.nativeLiveResize),
        ...input.bounds,
      },
    });
    createdRuntimeIds.add(id);
    exists = await invoke<boolean>("browser_webview_reconcile", {
      request: { id, nativeLiveResize: Boolean(input.nativeLiveResize), ...input.bounds },
    });
    if (!exists) throw new Error("Browser webview could not be attached.");
  }
  lastBounds.set(id, boundsKey);
  // The Browser surface can unmount while native creation or reconciliation
  // is still in flight. Honor the latest desired visibility before exposing
  // the child, otherwise that late completion can cover Home or another tool.
  if (!desiredVisibleRuntimeIds.has(id)) {
    visibleRuntimeIds.delete(id);
    await invoke("browser_webview_hide", { request: { id } }).catch(() => undefined);
    return;
  }
  visibleRuntimeIds.add(id);
}

export interface BrowserInspection {
  url?: string;
  title?: string;
  text?: string;
  truncated?: boolean;
  interactive?: BrowserInteractiveControl[];
}

export interface BrowserInteractiveControl {
  ref: string;
  tag: string;
  role: string;
  name: string;
}

export interface BrowserMistyPage {
  title: string;
  text: string;
  truncated: boolean;
  urlFingerprint: string;
  interactive: BrowserInteractiveControl[];
}

export function browserContentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function setBrowserWebviewsSuspended(suspended: boolean, reason = "default"): void {
  const wasSuspended = browserWebviewSuspensions.size > 0;
  if (suspended) browserOverlayResumeGeneration += 1;
  if (suspended) browserWebviewSuspensions.add(reason);
  else browserWebviewSuspensions.delete(reason);
  const isSuspended = browserWebviewSuspensions.size > 0;
  if (isSuspended && !wasSuspended) {
    setBrowserOverlayActive(true);
  } else if (!isSuspended && wasSuspended && typeof window !== "undefined") {
    scheduleBrowserOverlayResume();
  }
}

export function setBrowserPointerGestureActive(active: boolean): void {
  const wasActive = browserPointerGestureActive;
  browserPointerGestureActive = active;
  if (wasActive && !active && browserOverlayActive && browserWebviewSuspensions.size === 0) {
    scheduleBrowserOverlayResume();
  }
}

export function setBrowserPointerTrackingEnabled(enabled: boolean): void {
  if (browserPointerTrackingEnabled === enabled) return;
  browserPointerTrackingEnabled = enabled;
  browserPointerTrackingQueue = browserPointerTrackingQueue
    .catch(() => undefined)
    .then(() =>
      invoke<void>("browser_webviews_set_pointer_tracking", { enabled }).catch(() => undefined),
    );
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
      void browserOverlayQueue.then(() => {
        if (!browserOverlayActive && browserWebviewSuspensions.size === 0) {
          // Non-macOS runtimes park child views while renderer popovers are
          // open. Invalidate the cached frames so each desired page is shown
          // again even when its geometry did not change.
          desiredVisibleRuntimeIds.forEach((id) => lastBounds.delete(id));
          window.dispatchEvent(new Event(browserRuntimeResumeEvent));
        }
      });
    });
  });
}

function setBrowserOverlayActive(active: boolean): void {
  browserOverlayActive = active;
  if (typeof document !== "undefined") {
    document.documentElement.toggleAttribute("data-browser-overlay-active", active);
  }
  browserOverlayQueue = browserOverlayQueue
    .catch(() => undefined)
    .then(() =>
      invoke<void>("browser_webviews_set_overlay_active", { active }).catch(() => undefined),
    );
}

export async function browserOverlayReady(): Promise<void> {
  await browserOverlayQueue;
}

export function hideBrowserWebview(tab: BrowserRuntimeTab): Promise<void> {
  const id = registerBrowserRuntime(tab);
  desiredVisibleRuntimeIds.delete(id);
  visibleRuntimeIds.delete(id);
  // Always enqueue the hide. A create/reconcile operation may still be in
  // flight even when the frontend has not marked this runtime visible yet.
  // The native command safely no-ops when no child exists.
  return enqueue(id, async () => {
    await invoke("browser_webview_hide", { request: { id } }).catch(() => undefined);
  });
}

export async function closeBrowserRuntime(tab: WorkspaceTab): Promise<void> {
  const id = registerBrowserRuntime(tab);
  desiredVisibleRuntimeIds.delete(id);
  const grants = useBrowserRuntimeStore.getState().grants[tab.id] ?? [];
  await Promise.allSettled(grants.map((grant) => revokeBrowserAgentGrant(id, grant)));
  await enqueue(id, async () => {
    // Reopening a just-closed tab can request this same stable runtime while
    // grant cleanup is still in flight. The new request owns the child now;
    // do not let the stale close tear it down or delete its id mapping.
    if (desiredVisibleRuntimeIds.has(id)) return;
    if (createdRuntimeIds.has(id)) {
      await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
    }
    createdRuntimeIds.delete(id);
    visibleRuntimeIds.delete(id);
    lastBounds.delete(id);
    browserSyncStates.delete(id);
    runtimeTabIds.delete(id);
    useBrowserRuntimeStore.getState().removeTab(tab.id);
  });
}

export function hideAllBrowserWebviews(): Promise<void[]> {
  desiredVisibleRuntimeIds.clear();
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

export async function parkAllBrowserWebviews(): Promise<void> {
  const generation = ++browserParkGeneration;
  desiredVisibleRuntimeIds.clear();
  visibleRuntimeIds.clear();
  createdRuntimeIds.forEach((id) => lastBounds.delete(id));

  // Browser workspace cleanup may already have queued an individual hide.
  // Let that settle, then revive each child underneath the renderer so a
  // later Browser tab switch has no native hide/show gap.
  await Promise.all([...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)));
  if (generation !== browserParkGeneration || desiredVisibleRuntimeIds.size > 0) return;
  await invoke<void>("browser_webviews_park_all").catch(() => undefined);
  if (desiredVisibleRuntimeIds.size > 0 && typeof window !== "undefined") {
    desiredVisibleRuntimeIds.forEach((id) => lastBounds.delete(id));
    window.dispatchEvent(new Event(browserRuntimeResumeEvent));
  }
}

function serializeBounds(bounds: BrowserBounds, nativeLiveResize = false): string {
  return [bounds.x, bounds.y, bounds.width, bounds.height, nativeLiveResize ? 1 : 0]
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
