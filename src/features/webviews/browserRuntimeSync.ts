import { invoke } from "@tauri-apps/api/core";
import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import {
  browserRuntimeResumeEvent,
  browserScopeId,
  browserSyncStates,
  closedRuntimes,
  createdRuntimeIds,
  desiredVisibleRuntimeIds,
  enqueue,
  hideRequest,
  lastBounds,
  parkGeneration,
  registerBrowserRuntime,
  runtimeQueues,
  serializeBounds,
  setBrowserPagePresented,
  visibleRuntimeIds,
  type BrowserRuntimeTab,
  type BrowserSyncInput,
  type BrowserSyncState,
} from "./browserRuntimeSets";
import { cancelDeferredHide, markBrowserPerf } from "./browserSwitchHandoff";
import { presentReconciledPage } from "./browserRuntimeVisibility";

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
  parkGeneration.current += 1;
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
