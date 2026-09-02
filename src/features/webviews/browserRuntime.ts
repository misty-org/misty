import type { WorkspaceView } from "@/features/workspace";
import { parseBrowserViewState } from "@/features/workspace/model";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ActiveBrowserAgentGrant } from "./browserAgentAccess";
import type { BrowserBounds, BrowserTheme } from "./types";
export type {
  BrowserCompatibilityIssue,
  BrowserHistory,
  BrowserInspection,
  BrowserInteractiveControl,
  BrowserMistyPage,
  HistoryStep,
  PagePreview,
} from "./browserRuntimeTypes";

import type {
  BrowserCompatibilityIssue,
  BrowserHistory,
  HistoryStep,
  PagePreview,
} from "./browserRuntimeTypes";
export function savePagePreview(tabId: string, preview: PagePreview) {
  useBrowserRuntimeStore.setState((runtime) => {
    const previews = { ...runtime.previews };
    delete previews[tabId];
    previews[tabId] = preview;
    let bytes = 0;
    for (const key of Object.keys(previews).reverse()) {
      bytes += (previews[key].dataUrl?.length ?? 0) + (previews[key].document?.html.length ?? 0);
      if (bytes > 32_000_000) delete previews[key];
    }
    return { previews };
  });
}

export function pagePreviewGeneration() {
  return previewGeneration;
}

interface BrowserRuntimeUiState {
  /** Local, session-only thumbnails. Never included in workspace persistence or sync. */
  previews: Record<string, PagePreview>;
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
  travelHistory: (tabId: string, direction: -1 | 1) => HistoryStep | null;
  replaceHistory: (tabId: string, history: BrowserHistory) => void;
  resetNativeHistory: (tabId: string) => void;
  setError: (tabId: string, error: string | null) => void;
  setNotice: (tabId: string, notice: string | null) => void;
  setCompatibilityIssue: (tabId: string, issue: BrowserCompatibilityIssue | null) => void;
  setLoading: (tabId: string, loading: boolean) => void;
  removeTab: (tabId: string) => void;
}

export const useBrowserRuntimeStore = create<BrowserRuntimeUiState>((set, get) => ({
  previews: {},
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
      const index = current.index + 1;
      const native = current.native;
      const next =
        existingIndex >= 0 && Math.abs(existingIndex - current.index) === 1
          ? { ...current, index: existingIndex }
          : {
              entries: [...current.entries.slice(0, current.index + 1), url],
              index,
              // The webview pushed this entry too.
              native:
                native && native.lo <= current.index && current.index <= native.hi
                  ? { lo: native.lo, hi: index }
                  : { lo: index, hi: index },
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
  travelHistory: (tabId, direction) => {
    const current = get().histories[tabId];
    if (!current) return null;
    const index = current.index + direction;
    const url = current.entries[index];
    if (index < 0 || url === undefined) return null;
    const range = current.native;
    const native = Boolean(
      range &&
      range.lo <= current.index &&
      current.index <= range.hi &&
      range.lo <= index &&
      index <= range.hi,
    );
    set((state) => ({
      histories: {
        ...state.histories,
        // A direct load leaves the webview knowing only the loaded entry.
        [tabId]: { ...current, index, native: native ? range : { lo: index, hi: index } },
      },
    }));
    return { url, native };
  },
  replaceHistory: (tabId, history) =>
    set((state) => ({
      histories: {
        ...state.histories,
        [tabId]: { ...history, native: { lo: history.index, hi: history.index } },
      },
    })),
  resetNativeHistory: (tabId) =>
    set((state) => {
      const current = state.histories[tabId];
      if (!current) return state;
      return {
        histories: {
          ...state.histories,
          [tabId]: { ...current, native: { lo: current.index, hi: current.index } },
        },
      };
    }),
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
      const previews = { ...state.previews };
      delete grants[tabId];
      delete histories[tabId];
      delete errors[tabId];
      delete notices[tabId];
      delete compatibilityIssues[tabId];
      delete loading[tabId];
      delete previews[tabId];
      return { grants, histories, errors, notices, compatibilityIssues, loading, previews };
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
let previewGeneration = 0;
const pendingPreviews = new Set<string>();
let browserOverlayQueue = Promise.resolve();
let browserPointerGestureActive = false;
let browserOverlayResumeGeneration = 0;
let browserOverlayActive = false;
let browserPointerTrackingEnabled: boolean | null = null;
let browserPointerTrackingQueue = Promise.resolve();

export const browserRuntimeResumeEvent = "misty:browser-runtime-resume";

/** Native handoff has closed the previous physical profile. Settle old runtime
 * work before invalidating cached handles; visible panes then reopen normally. */
export async function browserProfileChanged(
  stillCurrent: () => boolean = () => true,
): Promise<void> {
  previewGeneration += 1;
  useBrowserRuntimeStore.setState({ previews: {} });
  await Promise.all([...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)));
  if (!stillCurrent()) return;
  createdRuntimeIds.clear();
  visibleRuntimeIds.clear();
  lastBounds.clear();
  useBrowserRuntimeStore.setState({ grants: {}, errors: {}, loading: {} });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(browserRuntimeResumeEvent));
}

type BrowserRuntimeTab = Pick<WorkspaceView, "id" | "instanceKey">;
type BrowserSyncInput = {
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

export function browserRuntimeIdForScope(scopeId: string): string | null {
  // Resolve only live native browser scopes.
  if (scopeId.startsWith("scope-")) {
    const id = scopeId.slice("scope-".length);
    if (runtimeTabIds.has(id)) return id;
  }
  return null;
}

/** Capture an already-rendered page. Background reads never bring it to the front. */
export async function captureBrowserPagePreview(
  tab: WorkspaceView,
  bounds: { width: number; height: number },
  stillCurrent: () => boolean,
  background = false,
  previewRuntimeId?: string,
): Promise<void> {
  const state = parseBrowserViewState(tab.state);
  const id = previewRuntimeId ?? browserRuntimeId(tab);
  if (
    state.private ||
    !/^https?:\/\//i.test(state.url) ||
    (!background && (!visibleRuntimeIds.has(id) || browserWebviewSuspensions.size > 0)) ||
    useBrowserRuntimeStore.getState().loading[tab.id] ||
    pendingPreviews.has(id) ||
    bounds.width < 8 ||
    bounds.height < 8
  )
    return;
  const generation = previewGeneration;
  pendingPreviews.add(id);
  try {
    const result = await invoke<PagePreview>("browser_webview_preview_document", {
      request: { id },
    });
    if (!stillCurrent() || generation !== previewGeneration || result.url !== state.url) return;
    if (
      result.dataUrl &&
      (!/^data:image\/(png|jpeg);base64,/.test(result.dataUrl) || result.dataUrl.length > 8_000_000)
    ) {
      delete result.dataUrl;
    }
    if (
      result.document &&
      (typeof result.document.html !== "string" || result.document.html.length > 3_000_000)
    ) {
      delete result.document;
    }
    if (result.dataUrl || result.document) savePagePreview(tab.id, result);
  } catch {
    // A stopped or unsupported page remains resumable while no preview is available.
  } finally {
    pendingPreviews.delete(id);
  }
}

/** Prepare every browser card without focusing, navigating, or resizing its real tab. */
export async function prepareBrowserPagePreview(tab: WorkspaceView, stillCurrent: () => boolean) {
  const state = parseBrowserViewState(tab.state);
  if (state.private || !/^https?:\/\//i.test(state.url) || !stillCurrent()) return;
  const existing = browserRuntimeCreated(tab);
  const id = existing ? browserRuntimeId(tab) : `preview-${crypto.randomUUID()}`;
  const generation = previewGeneration;
  const current = () => stillCurrent() && generation === previewGeneration;
  try {
    if (!existing) {
      await invoke("browser_webview_create", {
        request: {
          id,
          previewOnly: true,
          workspaceTabId: tab.id,
          url: state.url,
          ...(state.profileId ? { profileId: state.profileId } : {}),
          x: 100_000,
          y: 0,
          width: 1440,
          height: 900,
          theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        },
      });
    }
    for (let attempt = 0; attempt < 6 && current(); attempt++) {
      await captureBrowserPagePreview(tab, { width: 1440, height: 900 }, current, true, id);
      if (!current()) break;
      if (useBrowserRuntimeStore.getState().previews[tab.id]?.url === state.url) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } finally {
    if (!existing)
      await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
  }
}

export function registerBrowserRuntime(tab: BrowserRuntimeTab): string {
  const runtimeId = browserRuntimeId(tab);
  runtimeTabIds.set(runtimeId, tab.id);
  return runtimeId;
}

export function browserRuntimeCreated(tab: BrowserRuntimeTab): boolean {
  return createdRuntimeIds.has(browserRuntimeId(tab));
}

/** Remote URL changes held for pages on screen, applied once they are hidden. */
const deferredNavigations = new Map<
  string,
  { tab: BrowserRuntimeTab; url: string; stillCurrent: () => boolean }
>();

function releaseDeferredNavigation(id: string): void {
  const deferred = deferredNavigations.get(id);
  if (!deferred) return;
  deferredNavigations.delete(id);
  void navigateSyncedBrowserWebview(deferred.tab, deferred.url, deferred.stillCurrent).catch(
    () => undefined,
  );
}

/** Apply a committed sync URL to an existing page without showing or focusing
 * it. Unopened pages will use the projected URL when they are created. A page
 * on screen is never reloaded under its reader by another machine's
 * navigation: the change applies when the page is next hidden. */
export function navigateSyncedBrowserWebview(
  tab: BrowserRuntimeTab,
  url: string,
  stillCurrent: () => boolean,
): Promise<void> {
  const id = browserRuntimeId(tab);
  if (visibleRuntimeIds.has(id) || desiredVisibleRuntimeIds.has(id)) {
    deferredNavigations.set(id, { tab, url, stillCurrent });
    return Promise.resolve();
  }
  deferredNavigations.delete(id);
  return enqueue(id, async () => {
    // Creation/closing may still be queued, and a newer local or remote edit
    // may have superseded this URL while we waited for the native view.
    if (!createdRuntimeIds.has(id) || !stillCurrent()) return;
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    await invoke("browser_webview_navigate", { request: { id, url } });
  });
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
        workspaceTabId: input.tab.id,
        url: input.url,
        scopeId: input.scopeId ?? browserScopeId(input.tab),
        originSpaceId: input.originSpaceId,
        theme: input.theme,
        nativeLiveResize: Boolean(input.nativeLiveResize),
        ...(input.profileId ? { profileId: input.profileId } : {}),
        ...(parseBrowserViewState(input.tab.state).private ? { private: true } : {}),
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.profileProviderId ? { profileProviderId: input.profileProviderId } : {}),
        ...input.bounds,
      },
    });
    createdRuntimeIds.add(id);
    // A new webview's own history holds only the page it opened with.
    useBrowserRuntimeStore.getState().resetNativeHistory(input.tab.id);
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
        scopeId: input.scopeId ?? browserScopeId(input.tab),
        originSpaceId: input.originSpaceId,
        theme: input.theme,
        nativeLiveResize: Boolean(input.nativeLiveResize),
        ...(input.profileId ? { profileId: input.profileId } : {}),
        ...(parseBrowserViewState(input.tab.state).private ? { private: true } : {}),
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.profileProviderId ? { profileProviderId: input.profileProviderId } : {}),
        ...input.bounds,
      },
    });
    createdRuntimeIds.add(id);
    useBrowserRuntimeStore.getState().resetNativeHistory(input.tab.id);
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

export function setBrowserPointerTrackingEnabled(enabled: boolean): void {
  if (browserPointerTrackingEnabled === enabled) return;
  browserPointerTrackingEnabled = enabled;
  browserPointerTrackingQueue = browserPointerTrackingQueue
    .catch(() => undefined)
    .then(() =>
      invoke<void>("browser_webviews_set_pointer_tracking", { enabled }).catch(() => undefined),
    );
}

const internalPageTabs = new Set<string>();

/**
 * Marks a tab as showing a Misty-drawn page (misty://history and so on). Its
 * native page stays alive but hidden, and must not overwrite the tab's
 * address, title or icon while it sits behind the internal page.
 */
export function setBrowserTabShowsInternalPage(tabId: string, internal: boolean): void {
  if (internal) internalPageTabs.add(tabId);
  else internalPageTabs.delete(tabId);
}

export function browserTabShowsInternalPage(tabId: string): boolean {
  return internalPageTabs.has(tabId);
}

let browserDownloadDirectory: string | null = null;

/** Where website downloads are saved; empty means the Downloads folder. */
export function setBrowserDownloadDirectory(directory: string): void {
  if (browserDownloadDirectory === directory) return;
  browserDownloadDirectory = directory;
  void invoke<void>("browser_set_download_directory", { directory }).catch(() => undefined);
}

let browserDownloadPrompt: boolean | null = null;

/** Ask where to save each website download instead of saving automatically. */
export function setBrowserDownloadPrompt(enabled: boolean): void {
  if (browserDownloadPrompt === enabled) return;
  browserDownloadPrompt = enabled;
  void invoke<void>("browser_set_download_prompt", { enabled }).catch(() => undefined);
}

let browserStatusBubbleEnabled: boolean | null = null;

/** Shows or hides the hovered-link and loading bubble inside browser pages. */
export function setBrowserStatusBubbleEnabled(enabled: boolean): void {
  if (browserStatusBubbleEnabled === enabled) return;
  browserStatusBubbleEnabled = enabled;
  void invoke<void>("browser_webviews_set_status_bubble", { enabled }).catch(() => undefined);
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
  releaseDeferredNavigation(id);
  // Always enqueue the hide. A create/reconcile operation may still be in
  // flight even when the frontend has not marked this runtime visible yet.
  // The native command safely no-ops when no child exists.
  return enqueue(id, async () => {
    await invoke("browser_webview_hide", { request: { id } }).catch(() => undefined);
  });
}

export async function parkAllBrowserWebviews(): Promise<void> {
  const generation = ++browserParkGeneration;
  desiredVisibleRuntimeIds.clear();
  visibleRuntimeIds.clear();
  [...deferredNavigations.keys()].forEach(releaseDeferredNavigation);
  createdRuntimeIds.forEach((id) => lastBounds.delete(id));

  // Let in-flight creation, reconciliation, and individual hides settle
  // before hiding every native child. Keep the pages loaded, but do not
  // expose them again until their Browser surface requests reconciliation.
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
