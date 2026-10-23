import { invoke } from "@tauri-apps/api/core";
import { isBrowserLayoutMoving } from "./browserOverlayRuntime";
import { shownAdoptedPages } from "./browserAdoptedPages";
import { useBrowserRuntimeStore } from "./browserRuntimeStore";
import {
  adoptedPages,
  browserRuntimeId,
  browserRuntimeResumeEvent,
  browserSyncStates,
  closedRuntimes,
  createdRuntimeIds,
  desiredVisibleRuntimeIds,
  enqueue,
  keepLiveRuntimeIds,
  lastBounds,
  parkGeneration,
  registerBrowserRuntime,
  runtimeQueues,
  runtimeTabIds,
  setBrowserPagePresented,
  visibleRuntimeIds,
  type BrowserRuntimeTab,
} from "./browserRuntimeSets";
import {
  forgetDeferredNavigation,
  releaseAllDeferredNavigations,
} from "./browserRuntimeVisibility";
import {
  cancelDeferredHide,
  hasPendingHandoff,
  markBrowserPerf,
  onBrowserSettled,
} from "./browserSwitchHandoff";

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

const browserRuntimeCloseListeners = new Set<(tabId: string) => void>();

export function onBrowserRuntimeClose(listener: (tabId: string) => void): () => void {
  browserRuntimeCloseListeners.add(listener);
  return () => {
    browserRuntimeCloseListeners.delete(listener);
  };
}

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

/** Destroy a closed tab's native page so its media stops with it. `isClosed`
 * reports whether the tab is still gone; reopening it keeps the runtime. */
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
    forgetDeferredNavigation(id);
    lastBounds.delete(id);
    browserSyncStates.delete(id);
    runtimeTabIds.delete(id);
    if (![...runtimeTabIds.values()].includes(tab.id)) {
      useBrowserRuntimeStore.getState().removeTab(tab.id);
    }
  });
}

export async function parkAllBrowserWebviews(): Promise<void> {
  const generation = ++parkGeneration.current;
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
  releaseAllDeferredNavigations();
  createdRuntimeIds.forEach((id) => lastBounds.delete(id));

  // Let in-flight creation, reconciliation, and individual hides settle
  // before hiding every native child. Keep the pages loaded, but do not
  // expose them again until their Browser surface requests reconciliation.
  await Promise.all([...runtimeQueues.values()].map((pending) => pending.catch(() => undefined)));
  const keep = shownAdoptedPages();
  if (generation !== parkGeneration.current || desiredVisibleRuntimeIds.size > keep.length) return;
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
