import type { WorkspaceView } from "@/features/workspace";
import { parseBrowserViewState } from "@/features/workspace/model";
import { invoke } from "@tauri-apps/api/core";
import { checkBrowserOverlayTransparency } from "./browserOverlayGuard";
import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import {
  cancelDeferredHide,
  completeHandoff,
  deferHideUntilHandoff,
  hasPendingHandoff,
  markBrowserPerf,
  notifyBrowserSettled,
  onBrowserSettled,
} from "./browserSwitchHandoff";
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
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";
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
  useBrowserRuntimeStore.setState({ grants: {}, errors: {}, loading: {}, presented: {} });
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

/** New pages the host keeps parked until their first paint (Windows). */
const awaitingFirstPaint = new Set<string>();

/** Whether the tab's page is on screen in its host; until it is, the host paints a fill. */
function setBrowserPagePresented(runtimeId: string, presented: boolean): void {
  const tabId = runtimeTabIds.get(runtimeId) ?? adoptedPages.get(runtimeId);
  if (tabId) useBrowserRuntimeStore.getState().setPresented(tabId, presented);
}

/**
 * Pages another owner creates and closes, shown through this runtime all the same: an agent's
 * pages beside its chat (agentTabs.ts). They take the tab pages' placement, presented state,
 * first-paint hold, parking and switching, under their own runtime id, with the key their
 * presented state is kept under. This runtime never creates them, and they are not tabs: their
 * page events never reach the person's tabs or history.
 */
const adoptedPages = new Map<string, string>();
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
export function hideAdoptedBrowserPage(runtimeId: string): Promise<void> {
  if (!adoptedPages.has(runtimeId)) return Promise.resolve();
  adoptedBounds.delete(runtimeId);
  return hideBrowserRuntime(runtimeId).then(() => {
    // Shown again while it was going.
    if (desiredVisibleRuntimeIds.has(runtimeId)) return;
    adoptedPages.delete(runtimeId);
    lastBounds.delete(runtimeId);
  });
}

/** Adopted pages wanted on screen now, which parking and switching leave in place. */
function shownAdoptedPages(): string[] {
  return [...adoptedPages.keys()].filter((id) => desiredVisibleRuntimeIds.has(id));
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
    isIncognitoWindow() ||
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
  if (isIncognitoWindow() || !/^https?:\/\//i.test(state.url) || !stillCurrent()) return;
  const existing = browserRuntimeCreated(tab);
  const id = existing ? browserRuntimeId(tab) : `preview-${crypto.randomUUID()}`;
  const generation = previewGeneration;
  const current = () => stillCurrent() && generation === previewGeneration;
  const profileId = state.profileId;
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
  cancelDeferredHide(id);
  markBrowserPerf(id, "sync requested");
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
  const boundsKey = serializeBounds(input.bounds, input.nativeLiveResize);
  // A page created here may be parked until its first paint.
  let createdNow = !createdRuntimeIds.has(id);
  if (!createdRuntimeIds.has(id)) {
    markBrowserPerf(id, "create start");
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
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.profileProviderId ? { profileProviderId: input.profileProviderId } : {}),
        ...input.bounds,
      },
    });
    createdRuntimeIds.add(id);
    markBrowserPerf(id, "create done");
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
  if (!exists) createdNow = true;
  if (!exists) {
    createdRuntimeIds.delete(id);
    visibleRuntimeIds.delete(id);
    setBrowserPagePresented(id, false);
    await invoke("browser_webview_create", {
      request: {
        id,
        url: input.url,
        scopeId: input.scopeId ?? browserScopeId(input.tab),
        originSpaceId: input.originSpaceId,
        theme: input.theme,
        nativeLiveResize: Boolean(input.nativeLiveResize),
        ...(input.profileId ? { profileId: input.profileId } : {}),
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
  await presentReconciledPage(id, createdNow);
}

/**
 * Brings a reconciled page on screen, unless its host stopped wanting it meanwhile. A page still
 * parked for its first paint is not presented yet, and its host keeps its fill until it is.
 */
async function presentReconciledPage(id: string, createdNow: boolean): Promise<void> {
  markBrowserPerf(id, "reconciled");
  // The Browser surface can unmount while native creation or reconciliation
  // is still in flight. Honor the latest desired visibility before exposing
  // the child, otherwise that late completion can cover Home or another tool.
  if (!desiredVisibleRuntimeIds.has(id)) {
    visibleRuntimeIds.delete(id);
    setBrowserPagePresented(id, false);
    await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
    return;
  }
  visibleRuntimeIds.add(id);
  // A new page can exist yet still be parked until its first paint. The page
  // it replaces must stay up until it is really on screen, and its host keeps
  // its fill until then (its reveal comes back through this path).
  const held =
    createdNow || awaitingFirstPaint.has(id) || hasPendingHandoff()
      ? await invoke<boolean>("browser_webview_held", { request: { id } }).catch(() => false)
      : false;
  if (held) awaitingFirstPaint.add(id);
  else awaitingFirstPaint.delete(id);
  markBrowserPerf(id, held ? "held for first paint" : "presented");
  setBrowserPagePresented(id, !held);
  if (!held) completeHandoff(id);
  scheduleStrayPageSweep();
}

let strayPageSweepTimer = 0;

/**
 * Hides any tab page this window has on screen but no longer wants there. A page whose tab lost
 * track of it (its runtime id changed, the renderer reloaded, or the window switched Space while
 * it was being created) is otherwise never hidden again and covers whatever replaced it. Runs
 * after a page is shown or hidden, and at startup; with nothing wanted on screen it hides them
 * all. Waits out switch handoffs, layout moves and in-flight work, and spares pages parked for
 * picture in picture.
 */
export function scheduleStrayPageSweep(): void {
  if (typeof window === "undefined") return;
  window.clearTimeout(strayPageSweepTimer);
  strayPageSweepTimer = window.setTimeout(() => {
    void (async () => {
      await Promise.all(
        [...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)),
      );
      if (hasPendingHandoff() || isBrowserLayoutMoving()) {
        scheduleStrayPageSweep();
        return;
      }
      const keep = new Set([...desiredVisibleRuntimeIds, ...keepLiveRuntimeIds]);
      await invoke<void>("browser_webviews_hide_except", { request: { keep: [...keep] } }).catch(
        () => undefined,
      );
      // Whatever was hidden must be placed again when its tab next shows it.
      for (const id of [...visibleRuntimeIds]) {
        if (keep.has(id)) continue;
        visibleRuntimeIds.delete(id);
        setBrowserPagePresented(id, false);
        lastBounds.delete(id);
      }
    })();
  }, 400);
}

/**
 * Closes this window's tab pages that belong to no tab it still has (`liveTabs`: every tab of
 * every Space the window holds). Pages outlive a renderer reload so tabs can take them back;
 * the ones nobody takes back would otherwise stay alive, and audible, until the app quits.
 */
export async function closeOrphanBrowserPages(liveTabs: () => BrowserRuntimeTab[]): Promise<void> {
  await Promise.all([...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)));
  // Read the tabs after in-flight work settles, so a tab opened meanwhile keeps its page.
  const keep = new Set(liveTabs().map(browserRuntimeId));
  keepLiveRuntimeIds.forEach((id) => keep.add(id));
  await invoke<void>("browser_webviews_close_except", { request: { keep: [...keep] } }).catch(
    () => undefined,
  );
}

/**
 * Windows: switches the window's native pages the moment its active tabs change, before React
 * renders or any page measures itself. Hidden tabs wait in place beneath the renderer, already
 * drawn, so a switch only changes which page is on top: `ids` come up, every other page goes
 * under. The ordinary sync still runs afterward and corrects any page whose bounds moved.
 */
export function switchBrowserPages(ids: readonly string[]): void {
  // An agent's page beside its chat is not a tab, and stays up through any switch.
  const wanted = ids.filter((id) => createdRuntimeIds.has(id)).concat(shownAdoptedPages());
  const leaving = [...visibleRuntimeIds].filter((id) => !wanted.includes(id));
  for (const id of wanted) markBrowserPerf(id, "instant switch sent", true);
  // With no page coming up the window turns opaque now and covers the pages going under.
  if (!wanted.length) leaving.forEach((id) => setBrowserPagePresented(id, false));
  void invoke<string[]>("browser_webviews_show_only", { request: { ids: wanted } })
    .then((raised) => {
      for (const id of raised ?? []) {
        setBrowserPagePresented(id, true);
        markBrowserPerf(id, "instant switch raised");
      }
      // Pages going under stay presented until one has come up, so the window never turns
      // opaque in between.
      leaving.forEach((id) => setBrowserPagePresented(id, false));
    })
    .catch(() => undefined);
}

/** Whether a native page already exists for this tab, so showing it is only a reconcile. */
export function isBrowserRuntimeCreated(tab: BrowserRuntimeTab): boolean {
  return createdRuntimeIds.has(registerBrowserRuntime(tab));
}

/**
 * Loads a tab's page before the tab is shown, so clicking it finds the page ready instead of
 * loading it then. The page is created out of sight at `bounds` and stays hidden until its tab
 * shows it; a page that exists, or has work on its way, is left alone.
 */
export function prewarmBrowserWebview(input: BrowserSyncInput): Promise<void> {
  const id = registerBrowserRuntime(input.tab);
  if (createdRuntimeIds.has(id) || browserSyncStates.has(id) || runtimeQueues.has(id))
    return Promise.resolve();
  markBrowserPerf(id, "prewarm requested", true);
  const wanted = () => desiredVisibleRuntimeIds.has(id) || !createdRuntimeIds.has(id);
  // Not wanted on screen, so the sync creates it, places it and hides it again.
  return enqueue(id, () => applyBrowserSync(id, input)).then(async () => {
    if (!/win/i.test(navigator.platform) || wanted()) return;
    // Windows holds a new page off screen until it paints, and a page shown from off screen
    // has to draw again first. Once it has painted it waits beneath the renderer, in place and
    // drawn, like any tab hidden there. The wait stays outside the page's queue, so a click
    // meanwhile shows it at once.
    for (let waited = 0; waited < 2500; waited += 150) {
      const held = await invoke<boolean>("browser_webview_held", { request: { id } }).catch(
        () => false,
      );
      if (!held || wanted()) break;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    await enqueue(id, async () => {
      if (wanted()) return;
      await invoke("browser_webview_reconcile", {
        request: {
          id,
          nativeLiveResize: Boolean(input.nativeLiveResize),
          ...input.bounds,
          beneath: true,
        },
      });
      lastBounds.delete(id);
      if (wanted()) return;
      await invoke("browser_webview_hide", { request: hideRequest(id) });
      markBrowserPerf(id, "prewarmed beneath");
    });
  });
}

export function browserContentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Dispatched when the window's chrome color changes (its Space's color). */
export const windowChromeChangedEvent = "misty:window-chrome-changed";

/** Whether a layout move holds the pages: they keep their place until it has settled. */
export function isBrowserLayoutMoving(): boolean {
  return browserWebviewSuspensions.has("docking-layout");
}

export function setBrowserWebviewsSuspended(suspended: boolean, reason = "default"): void {
  const wasSuspended = browserWebviewSuspensions.size > 0;
  if (suspended) browserOverlayResumeGeneration += 1;
  if (suspended) browserWebviewSuspensions.add(reason);
  else if (browserWebviewSuspensions.delete(reason) && reason === "docking-layout")
    notifyBrowserSettled();
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

/** Callers pair each `true` with a later `false`; tracking stays on while any of them wants it. */
let browserPointerTrackingUsers = 0;

export function setBrowserPointerTrackingEnabled(requested: boolean): void {
  browserPointerTrackingUsers = Math.max(0, browserPointerTrackingUsers + (requested ? 1 : -1));
  const enabled = browserPointerTrackingUsers > 0;
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
  if (active && typeof document !== "undefined") {
    document.documentElement.toggleAttribute("data-browser-overlay-active", true);
    checkBrowserOverlayTransparency();
  }
  browserOverlayQueue = browserOverlayQueue
    .catch(() => undefined)
    .then(async () => {
      if (browserOverlayActive !== active) return;
      await invoke<void>("browser_webviews_set_overlay_active", { active }).catch(() => undefined);
      // While the page is still below the renderer it shows through the transparent host, and
      // painting the host's fill sooner covers it with a flat rectangle for a frame. Only once
      // the page is back above the renderer does the host get its fill again.
      if (!active && !browserOverlayActive && typeof document !== "undefined")
        document.documentElement.toggleAttribute("data-browser-overlay-active", false);
    });
}

export async function browserOverlayReady(): Promise<void> {
  await browserOverlayQueue;
}

/**
 * A positive `graceMs` keeps the page on screen while another browser tab is
 * about to take its place, so a switch never shows an empty frame between
 * them. The old page leaves as soon as the new one is presented.
 */
/** Pages floating a video in picture in picture: parked out of sight when their tab leaves, not
 * hidden, so the floating window's back-to-tab button still has a page to return to. */
const keepLiveRuntimeIds = new Set<string>();

export function setBrowserRuntimeKeepLive(runtimeId: string, keepLive: boolean): void {
  if (keepLive) keepLiveRuntimeIds.add(runtimeId);
  else keepLiveRuntimeIds.delete(runtimeId);
}

const hideRequest = (id: string) => ({ id, keepLive: keepLiveRuntimeIds.has(id) });

export function hideBrowserWebview(tab: BrowserRuntimeTab, graceMs = 0): Promise<void> {
  return hideBrowserRuntime(registerBrowserRuntime(tab), graceMs);
}

function hideBrowserRuntime(id: string, graceMs = 0): Promise<void> {
  desiredVisibleRuntimeIds.delete(id);
  visibleRuntimeIds.delete(id);
  releaseDeferredNavigation(id);
  // A hide can race the page's creation; the sweep catches any page left up.
  scheduleStrayPageSweep();
  if (graceMs > 0) {
    // The old page stays until the next one is presented; the fallback in
    // browserSwitchHandoff covers a page that never arrives.
    markBrowserPerf(id, "old page waiting to hand off", true);
    return new Promise<void>((resolve) => {
      deferHideUntilHandoff(id, () => {
        // The tab was shown again, or its runtime closed, while waiting.
        if (desiredVisibleRuntimeIds.has(id)) return resolve();
        void enqueue(id, async () => {
          if (desiredVisibleRuntimeIds.has(id)) return;
          // It stays presented until the next page is, so the window never turns opaque between.
          setBrowserPagePresented(id, false);
          await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
        }).then(resolve);
      });
    });
  }
  cancelDeferredHide(id);
  // The fill goes in under the page before the page leaves, never after.
  setBrowserPagePresented(id, false);
  // Always enqueue the hide. A create/reconcile operation may still be in
  // flight even when the frontend has not marked this runtime visible yet.
  // The native command safely no-ops when no child exists.
  return enqueue(id, async () => {
    await invoke("browser_webview_hide", { request: hideRequest(id) }).catch(() => undefined);
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
/**
 * Resolves once a tab switch has landed: no handoff or layout move is pending and a page is on
 * screen (or none is wanted), then a frame later so the new page has been presented. Driven by
 * the events that end a switch, not by a clock.
 */
function whenSwitchSettled(): Promise<void> {
  const ready = () =>
    !hasPendingHandoff() &&
    !isBrowserLayoutMoving() &&
    (desiredVisibleRuntimeIds.size === 0 ||
      Object.values(useBrowserRuntimeStore.getState().presented).some(Boolean));
  return new Promise<void>((resolve) => {
    const done = () => {
      stops.forEach((stop) => stop());
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    };
    const check = () => {
      if (ready()) done();
    };
    const stops: Array<() => void> = [
      useBrowserRuntimeStore.subscribe(check),
      onBrowserSettled(check),
    ];
    if (ready()) done();
  });
}

export async function closeBrowserRuntime(
  tab: BrowserRuntimeTab,
  isClosed: () => boolean,
): Promise<void> {
  const id = registerBrowserRuntime(tab);
  desiredVisibleRuntimeIds.delete(id);
  cancelDeferredHide(id);
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
    // Closing a tab that was in front is a tab switch: the neighbor comes up first, and the old
    // page is destroyed behind it. Destroying a page window while it is still on screen repaints
    // its area white for a frame. It is silenced at once, so it cannot keep playing meanwhile.
    void invoke("browser_webview_set_muted", { request: { id, muted: true } }).catch(
      () => undefined,
    );
    await whenSwitchSettled();
    if (!isClosed()) {
      // Reopened while it waited: it stays, and plays again.
      void invoke("browser_webview_set_muted", { request: { id, muted: false } }).catch(
        () => undefined,
      );
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

export async function parkAllBrowserWebviews(): Promise<void> {
  const generation = ++browserParkGeneration;
  // Adopted pages on screen stay where they are: an agent's page beside its chat is on the
  // Agents page, which is what parks the tabs.
  const kept = new Set(shownAdoptedPages());
  const keptKeys = new Set([...kept].map((id) => adoptedPages.get(id)!));
  for (const id of [...desiredVisibleRuntimeIds])
    if (!kept.has(id)) desiredVisibleRuntimeIds.delete(id);
  for (const id of [...visibleRuntimeIds]) if (!kept.has(id)) visibleRuntimeIds.delete(id);
  useBrowserRuntimeStore.setState((state) => ({
    presented: Object.fromEntries(
      Object.entries(state.presented).filter(([key]) => keptKeys.has(key)),
    ),
  }));
  [...deferredNavigations.keys()].forEach(releaseDeferredNavigation);
  createdRuntimeIds.forEach((id) => lastBounds.delete(id));

  // Let in-flight creation, reconciliation, and individual hides settle
  // before hiding every native child. Keep the pages loaded, but do not
  // expose them again until their Browser surface requests reconciliation.
  await Promise.all([...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)));
  const keep = shownAdoptedPages();
  if (generation !== browserParkGeneration || desiredVisibleRuntimeIds.size > keep.length) return;
  await (
    keep.length
      ? invoke<void>("browser_webviews_park_all", { request: { keep } })
      : invoke<void>("browser_webviews_park_all")
  ).catch(() => undefined);
  if (desiredVisibleRuntimeIds.size > keep.length && typeof window !== "undefined") {
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
    .map((value) => String(Math.round(value * 2) / 2))
    .concat(bounds.cornerColor ? [bounds.cornerColor] : [])
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
