import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { registerRecoveryFlush } from "../recovery/recoveryStorage";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  browserRuntimeResumeEvent,
} from "../page-runtime/browserRuntimeSets";
import { holdMedia, keepMediaHolds, releaseMedia } from "../page-runtime/mediaHold";
import { isUntouched } from "./adoptWindowTabs";
import { dockTreeViews } from "../panes/dockTree";
import { activateTab, emptyTab, layoutTabs } from "../panes/layoutTabs";
import type { WorkspaceTab } from "./workspaceViews";
import {
  encodedFields,
  tabFields,
  tabFromFields,
  tabStaysHere,
  usableFields,
  type TabFields,
} from "./profileTabRecord";
import { currentProfile } from "../profiles/profileWindow";
import { keepPreloads, preloadArrived, preloadSeen, preloadsToReload } from "./tabPreload";
import { keepFromElsewhere, markFromElsewhere } from "./tabsFromElsewhere";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { normalizeWorkspaceLayout } from "../profiles/windows";
import { migrateRetiredWorkspaceTab } from "../recovery/workspaceMigrations";

/**
 * Keeps this window's tabs and the profile's in step. A tab closed here is closed everywhere, a
 * tab from elsewhere arrives without a page until `tabPreload` lets it load, and a window closing
 * says nothing: its tabs stay in the profile. The native side knows which window holds which tab.
 *
 * A tab from a computer on an older version can hold a person's web pages. Those don't open
 * here: the tab arrives without them, and one that held nothing else isn't taken, which closes
 * it for the profile the way closing it here would.
 */
const publishDelayMs = 1_000;
/** Sign-ins for a site come in several records; a page loads again once for all of them. */
const signInReloadDelayMs = 2_000;

interface TabsForWindow {
  tabs: { id: string; fields: unknown }[];
  removed: string[];
}

function ownTabs(): { tab: WorkspaceTab; fields: TabFields }[] {
  const { layout } = useWorkspaceStore.getState();
  return layoutTabs(layout)
    .filter((tab) => !tabStaysHere(tab))
    .map((tab, order) => ({ tab, fields: tabFields(tab, order) }));
}

export function startProfileTabs(): () => void {
  /** What each tab last said, here or from elsewhere. Only differences get sent. */
  const baseline = new Map<string, string>();
  const settling = new Map<string, number>();
  let stopped = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let signInTimer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  /** Until the window says otherwise, nobody is taken to be here. */
  let focused = false;

  const releaseShown = () => {
    const { layout } = useWorkspaceStore.getState();
    const shown = layoutTabs(layout).find((tab) => tab.id === layout.activeTabId);
    if (!shown || !focused) return;
    for (const view of dockTreeViews(shown.root)) {
      releaseMedia(view.id, browserRuntimeCreated(view) ? browserRuntimeId(view) : undefined);
    }
  };

  const inOrder = (work: () => Promise<void>) => {
    queue = queue.then(work, work).catch(() => undefined);
    return queue;
  };

  const publish = async () => {
    if (stopped || !started) return;
    const now = Date.now();
    const own = ownTabs();
    const present = new Set(own.map(({ tab }) => tab.id));
    const changed: { id: string; fields: TabFields }[] = [];
    for (const { tab, fields } of own) {
      const text = encodedFields(fields);
      if (baseline.get(tab.id) === text) continue;
      const settlesUntil = settling.get(tab.id);
      if (settlesUntil !== undefined && settlesUntil > now) {
        baseline.set(tab.id, text);
        continue;
      }
      changed.push({ id: tab.id, fields });
    }
    await invoke("profile_tabs_publish", { present: [...present], changed });
    for (const { id, fields } of changed) baseline.set(id, encodedFields(fields));
    // A tab reopened later must count as changed, or the record stays deleted.
    for (const id of baseline.keys()) if (!present.has(id)) baseline.delete(id);
    for (const [id, until] of settling) {
      if (until <= now || !present.has(id)) settling.delete(id);
    }
  };

  const apply = (result: TabsForWindow) => {
    const incoming = result.tabs.filter(
      (tab): tab is { id: string; fields: TabFields } =>
        usableFields(tab.fields) && baseline.get(tab.id) !== encodedFields(tab.fields),
    );
    const removed = new Set(result.removed);
    for (const id of removed) baseline.delete(id);
    if (!incoming.length && !removed.size) return;
    const state = useWorkspaceStore.getState();
    const order = new Map<string, number>();
    let tabs = layoutTabs(state.layout).filter((tab) => !removed.has(tab.id));
    tabs.forEach((tab, index) => order.set(tab.id, index));
    const arrived: string[] = [];
    for (const { id, fields } of incoming) {
      baseline.set(id, encodedFields(fields));
      order.set(id, fields.order);
      const previous = tabs.find((tab) => tab.id === id);
      const next = migrateRetiredWorkspaceTab(tabFromFields(id, fields, previous));
      if (!next) {
        tabs = tabs.filter((tab) => tab.id !== id);
        continue;
      }
      if (previous) {
        tabs = tabs.map((tab) => (tab.id === id ? next : tab));
      } else {
        tabs.push(next);
        arrived.push(id);
        markFromElsewhere(dockTreeViews(next.root).map((view) => view.id));
      }
    }
    const viewIds = tabs.flatMap((tab) => dockTreeViews(tab.root).map((view) => view.id));
    keepFromElsewhere(viewIds);
    keepPreloads(new Set(viewIds));
    keepMediaHolds(new Set(viewIds));
    // A window showing only its first new tab takes up where the profile was.
    const untouched = arrived.length > 0 && isUntouched(state.layout);
    if (untouched) tabs = tabs.filter((tab) => !tabStaysHere(tab));
    if (!tabs.length) tabs = [emptyTab()];
    const end = tabs.length;
    tabs = [...tabs].sort((a, b) => (order.get(a.id) ?? end) - (order.get(b.id) ?? end));
    const held = tabs.find((tab) => tab.id === state.layout.activeTabId);
    const first = untouched ? tabs.find((tab) => arrived.includes(tab.id)) : undefined;
    const active = held ?? first ?? tabs[0];
    for (const tab of tabs) {
      if (!arrived.includes(tab.id) || (focused && tab.id === active.id)) continue;
      for (const view of dockTreeViews(tab.root)) void holdMedia(view.id);
    }
    // Sends nothing until opened: its page may redirect, and that's no one's browsing yet.
    const waiting = tabs.filter((tab) => arrived.includes(tab.id) && tab.id !== active.id);
    for (const { id } of waiting) settling.set(id, Number.POSITIVE_INFINITY);
    preloadArrived(
      waiting.flatMap((tab) => dockTreeViews(tab.root).map((view) => ({ id: view.id, view }))),
      () => window.dispatchEvent(new Event(browserRuntimeResumeEvent)),
    );
    useWorkspaceStore.setState({
      layout: normalizeWorkspaceLayout(activateTab({ ...state.layout, tabs }, active.id)),
    });
  };

  const sync = () =>
    inOrder(async () => {
      if (stopped) return;
      clearTimeout(timer);
      if (started) await publish();
      const local = layoutTabs(useWorkspaceStore.getState().layout).map((tab) => tab.id);
      const result = await invoke<TabsForWindow>("profile_tabs_sync", { local });
      if (stopped) return;
      apply(result);
      started = true;
      await publish();
    });

  const reloadForSignIn = () => {
    clearTimeout(signInTimer);
    signInTimer = setTimeout(() => {
      for (const view of preloadsToReload<ReturnType<typeof dockTreeViews>[number]>()) {
        if (!browserRuntimeCreated(view)) continue;
        void invoke("browser_webview_reload", {
          request: { id: browserRuntimeId(view) },
        }).catch(() => undefined);
      }
    }, signInReloadDelayMs);
  };

  const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
    if (state.layout === previous.layout) return;
    const opened = layoutTabs(state.layout).find((tab) => tab.id === state.layout.activeTabId);
    if (opened) {
      if (settling.get(opened.id) === Number.POSITIVE_INFINITY) settling.delete(opened.id);
      for (const view of dockTreeViews(opened.root)) preloadSeen(view.id);
    }
    releaseShown();
    clearTimeout(timer);
    timer = setTimeout(() => void inOrder(publish), publishDelayMs);
  });
  const unregister = registerRecoveryFlush(() => {
    clearTimeout(timer);
    return inOrder(publish) as Promise<void>;
  });
  const stopListening = listen<{ profile: string; collection: string; remote: boolean }>(
    "misty://profile-records-changed",
    ({ payload }) => {
      if (stopped || !payload.remote || payload.profile !== currentProfile().id) return;
      if (payload.collection === "tabs") void sync();
      if (payload.collection === "cookies" || payload.collection === "local_storage") {
        reloadForSignIn();
      }
    },
  ).catch(() => undefined);
  // Only ever costs a hold lifted late: it must not get in the way of restoring the workspace.
  const stopFocus = (async () => {
    const current = getCurrentWindow();
    const stop = await current.onFocusChanged(({ payload }) => {
      focused = payload;
      releaseShown();
    });
    focused = await current.isFocused();
    releaseShown();
    return stop;
  })().catch(() => undefined);
  void sync();

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(signInTimer);
    unsubscribe();
    unregister();
    void stopListening.then((stop) => stop?.());
    void stopFocus.then((stop) => stop?.());
  };
}
