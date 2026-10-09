import type { WorkspaceView } from "@/features/workspace";
import { parseBrowserViewState } from "@/features/workspace/model";
import { invoke } from "@tauri-apps/api/core";
import { browserProfileFor } from "./browserProfileResolver";
import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import type { BrowserBounds, BrowserTheme } from "./types";
export { useBrowserRuntimeStore } from "./browserRuntimeStore";
export type {
  BrowserCompatibilityIssue,
  BrowserHistory,
  BrowserInspection,
  BrowserInteractiveControl,
  BrowserMistyPage,
  HistoryStep,
  PagePreview,
} from "./browserRuntimeTypes";

import type { PagePreview } from "./browserRuntimeTypes";
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

const createdRuntimeIds = new Set<string>();
const visibleRuntimeIds = new Set<string>();
const desiredVisibleRuntimeIds = new Set<string>();
const lastBounds = new Map<string, string>();
const runtimeTabIds = new Map<string, string>();
const runtimeQueues = new Map<string, Promise<void>>();
const browserSyncStates = new Map<string, BrowserSyncState>();
/** Runtimes whose tab was closed, with a check for whether it is still gone. */
const closedRuntimes = new Map<string, () => boolean>();
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
  const profileId = browserProfileFor(tab.id, state.profileId);
  try {
    if (!existing) {
      await invoke("browser_webview_create", {
        request: {
          id,
          previewOnly: true,
          workspaceTabId: tab.id,
          url: state.url,
          ...(profileId ? { profileId } : {}),
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
  // A pane that is still unmounting can measure once more after its tab
  // closed. Recreating the page would start its audio again with no tab left
  // to stop it; only a reopened tab may bring the runtime back.
  const closed = closedRuntimes.get(id);
  if (closed?.()) {
    desiredVisibleRuntimeIds.delete(id);
    return;
  }
  closedRuntimes.delete(id);
  // A view in a device profile opens in that profile's own website data.
  const profileId = browserProfileFor(input.tab.id, input.profileId);
  if (profileId) input = { ...input, profileId };
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

function overlayParksChildViews(): boolean {
  if (typeof navigator !== "undefined" && navigator.platform) {
    if (/mac/i.test(navigator.platform)) return false;
    if (/win/i.test(navigator.platform)) return false;
    if (/linux/i.test(navigator.platform)) return true;
  }
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    if (/macintosh|mac os x/i.test(navigator.userAgent)) return false;
    if (/windows/i.test(navigator.userAgent)) return false;
    if (/linux/i.test(navigator.userAgent)) return true;
  }
  if (typeof process !== "undefined" && process.platform) {
    if (process.platform === "darwin" || process.platform === "win32") return false;
    if (process.platform === "linux") return true;
  }
  return false;
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
      void browserOverlayReady().then(() => {
        if (
          !browserOverlayActive &&
          browserWebviewSuspensions.size === 0 &&
          overlayParksChildViews()
        ) {
          // WebKitGTK (Linux) parks child views while renderer popovers are
          // open. Invalidate the cached frames so each desired page is shown
          // again even when its geometry did not change. On macOS and Windows,
          // native views stay alive in their sibling z-order.
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
    .then(() => {
      if (browserOverlayActive !== active) return;
      return invoke<void>("browser_webviews_set_overlay_active", { active }).catch(() => undefined);
    });
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

const browserRuntimeCloseListeners = new Set<(tabId: string) => void>();

export function onBrowserRuntimeClose(listener: (tabId: string) => void): () => void {
  browserRuntimeCloseListeners.add(listener);
  return () => {
    browserRuntimeCloseListeners.delete(listener);
  };
}

/** Destroy a closed tab's native page so its media stops with it. `isClosed`
 * reports whether the tab is still gone; reopening it keeps the runtime. */
export async function closeBrowserRuntime(
  tab: BrowserRuntimeTab,
  isClosed: () => boolean,
): Promise<void> {
  const id = registerBrowserRuntime(tab);
  desiredVisibleRuntimeIds.delete(id);
  closedRuntimes.set(id, isClosed);
  const grants = useBrowserRuntimeStore.getState().grants[tab.id] ?? [];
  await Promise.allSettled(
    grants.map((grant) =>
      invoke("browser_agent_grant_revoke", { request: { id, grantId: grant.id } }).catch(
        () => undefined,
      ),
    ),
  );
  browserRuntimeCloseListeners.forEach((listener) => {
    try {
      listener(tab.id);
    } catch {
      // Ignore listener failures during close.
    }
  });
  await enqueue(id, async () => {
    // Reopening a just-closed tab can request this same stable runtime while
    // grant cleanup is still in flight. The new request owns the child now;
    // do not let the stale close tear it down or delete its id mapping.
    if (!isClosed()) {
      closedRuntimes.delete(id);
      return;
    }
    // Close even when this module lost track of the page (a profile switch or
    // renderer reload clears createdRuntimeIds); the native command no-ops
    // when no page exists.
    await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
    createdRuntimeIds.delete(id);
    visibleRuntimeIds.delete(id);
    deferredNavigations.delete(id);
    lastBounds.delete(id);
    browserSyncStates.delete(id);
    runtimeTabIds.delete(id);
    if (![...runtimeTabIds.values()].includes(tab.id)) {
      useBrowserRuntimeStore.getState().removeTab(tab.id);
    }
  });
}

/** Native pages that exist now, with the workspace tab each belongs to. */
export function liveBrowserRuntimes(): { id: string; tabId: string; visible: boolean }[] {
  return [...createdRuntimeIds].map((id) => ({
    id,
    tabId: runtimeTabIds.get(id) ?? "",
    visible: visibleRuntimeIds.has(id) || desiredVisibleRuntimeIds.has(id),
  }));
}

/**
 * Puts a hidden page to sleep: its native view is closed to free memory while
 * the tab stays. Showing the tab creates the page again at its current address.
 * Resolves false when the page was shown, closed or recreated meanwhile.
 */
export function sleepBrowserRuntime(id: string): Promise<boolean> {
  let slept = false;
  return enqueue(id, async () => {
    if (
      !createdRuntimeIds.has(id) ||
      visibleRuntimeIds.has(id) ||
      desiredVisibleRuntimeIds.has(id) ||
      closedRuntimes.has(id)
    )
      return;
    await invoke("browser_webview_close", { request: { id } }).catch(() => undefined);
    createdRuntimeIds.delete(id);
    lastBounds.delete(id);
    deferredNavigations.delete(id);
    slept = true;
  }).then(() => slept);
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
  return [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    nativeLiveResize ? 1 : 0,
    ...(bounds.cornerRadii ?? []),
  ]
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
