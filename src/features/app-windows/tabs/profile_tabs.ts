import { invoke } from "@tauri-apps/api/core";
import { registerRecoveryFlush } from "../recovery/recovery_storage";
import { isUntouched } from "./adopt_window_tabs";
import { activateTab, emptyTab, layoutTabs } from "../panes/layout_tabs";
import type { WorkspaceTab } from "./workspace_views";
import {
  encodedFields,
  tabFields,
  tabFromFields,
  tabStaysHere,
  usableFields,
  type TabFields,
} from "./profile_tab_record";
import { useWorkspaceStore } from "./use_workspace_store";
import { normalizeWorkspaceLayout } from "../profiles/windows";
import { knownWorkspaceTab } from "../recovery/known_workspace_views";

const publishDelayMs = 1_000;

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
  const baseline = new Map<string, string>();
  let stopped = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const inOrder = (work: () => Promise<void>) => {
    queue = queue.then(work, work).catch(() => undefined);
    return queue;
  };

  const publish = async () => {
    if (stopped || !started) return;
    const own = ownTabs();
    const present = new Set(own.map(({ tab }) => tab.id));
    const changed: { id: string; fields: TabFields }[] = [];
    for (const { tab, fields } of own) {
      const text = encodedFields(fields);
      if (baseline.get(tab.id) === text) continue;
      changed.push({ id: tab.id, fields });
    }
    await invoke("profile_tabs_publish", { present: [...present], changed });
    for (const { id, fields } of changed) baseline.set(id, encodedFields(fields));
    for (const id of baseline.keys()) if (!present.has(id)) baseline.delete(id);
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
      const next = knownWorkspaceTab(tabFromFields(id, fields, previous));
      if (!next) {
        tabs = tabs.filter((tab) => tab.id !== id);
        continue;
      }
      if (previous) {
        tabs = tabs.map((tab) => (tab.id === id ? next : tab));
      } else {
        tabs.push(next);
        arrived.push(id);
      }
    }
    const untouched = arrived.length > 0 && isUntouched(state.layout);
    if (untouched) tabs = tabs.filter((tab) => !tabStaysHere(tab));
    if (!tabs.length) tabs = [emptyTab()];
    const end = tabs.length;
    tabs = [...tabs].sort((a, b) => (order.get(a.id) ?? end) - (order.get(b.id) ?? end));
    const held = tabs.find((tab) => tab.id === state.layout.activeTabId);
    const first = untouched ? tabs.find((tab) => arrived.includes(tab.id)) : undefined;
    const active = held ?? first ?? tabs[0];
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

  const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
    if (state.layout === previous.layout) return;
    clearTimeout(timer);
    timer = setTimeout(() => void inOrder(publish), publishDelayMs);
  });
  const unregister = registerRecoveryFlush(() => {
    clearTimeout(timer);
    return inOrder(publish) as Promise<void>;
  });
  void sync();

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    unregister();
  };
}
