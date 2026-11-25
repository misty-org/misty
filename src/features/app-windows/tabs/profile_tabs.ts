import { invoke } from "@tauri-apps/api/core";
import { registerRecoveryFlush } from "../recovery/recovery_storage";
import { isUntouched } from "./adopt_window_tabs";
import { activateTab, emptyTab, layoutTabs } from "../panes/layout_tabs";
import type { WorkspaceLayout, WorkspaceTab } from "./workspace_views";
import {
  encodedFields,
  fieldsGroup,
  tabFields,
  tabFromFields,
  tabStaysHere,
  usableFields,
  type TabFields,
} from "./profile_tab_record";
import { useWorkspaceStore, type WorkspaceStore } from "./use_workspace_store";
import { emptyAsideWorkspace, type AsideWorkspace, type WorkspaceSide } from "./workspace_sides";
import { normalizeWorkspaceLayout } from "../profiles/windows";
import { knownWorkspaceTab } from "../recovery/known_workspace_views";

const publishDelayMs = 1_000;

interface TabsForWindow {
  tabs: { id: string; fields: unknown }[];
  removed: string[];
}

function ownTabs(): { tab: WorkspaceTab; fields: TabFields }[] {
  const { layout, side, asides } = useWorkspaceStore.getState();
  const sides: [WorkspaceLayout, WorkspaceSide | undefined][] = [[layout, side]];
  if (side)
    for (const [key, aside] of Object.entries(asides ?? {})) sides.push([aside.layout, key]);
  return sides.flatMap(([held, heldSide]) =>
    layoutTabs(held)
      .filter((tab) => !tabStaysHere(tab))
      .map((tab, order) => ({
        tab,
        fields: tabFields(
          tab,
          order,
          heldSide,
          held.groups?.find((group) => group.id === tab.group),
        ),
      })),
  );
}

function localTabIds(): string[] {
  const { layout, asides } = useWorkspaceStore.getState();
  return [
    ...layoutTabs(layout),
    ...Object.values(asides ?? {}).flatMap((aside) => layoutTabs(aside.layout)),
  ].map((tab) => tab.id);
}

function mergeTabs(
  layout: WorkspaceLayout,
  incoming: { id: string; fields: TabFields }[],
  removed: Set<string>,
): WorkspaceLayout {
  const held = layoutTabs(layout);
  if (!incoming.length && !held.some((tab) => removed.has(tab.id))) return layout;
  const order = new Map<string, number>();
  let tabs = held.filter((tab) => !removed.has(tab.id));
  tabs.forEach((tab, index) => order.set(tab.id, index));
  const arrived: string[] = [];
  const groups = [...(layout.groups ?? [])];
  for (const { fields } of incoming) {
    const group = fieldsGroup(fields);
    if (!group) continue;
    const at = groups.findIndex((known) => known.id === group.id);
    if (at < 0) groups.push(group);
    else groups[at] = { ...groups[at], title: group.title, color: group.color };
  }
  for (const { id, fields } of incoming) {
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
  const untouched = arrived.length > 0 && isUntouched(layout);
  if (untouched) tabs = tabs.filter((tab) => !tabStaysHere(tab));
  if (!tabs.length) tabs = [emptyTab()];
  const end = tabs.length;
  tabs = [...tabs].sort((a, b) => (order.get(a.id) ?? end) - (order.get(b.id) ?? end));
  const kept = tabs.find((tab) => tab.id === layout.activeTabId);
  const first = untouched ? tabs.find((tab) => arrived.includes(tab.id)) : undefined;
  const active = kept ?? first ?? tabs[0];
  return normalizeWorkspaceLayout(
    activateTab({ ...layout, tabs, groups: groups.length ? groups : undefined }, active.id),
  );
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
    for (const { id, fields } of incoming) baseline.set(id, encodedFields(fields));
    const state = useWorkspaceStore.getState();
    const sideOfTab = ({ fields }: (typeof incoming)[number]) =>
      !state.side || !fields.side ? state.side : fields.side;
    const here = incoming.filter((tab) => sideOfTab(tab) === state.side);
    const leaving = (kept: typeof incoming) =>
      new Set([
        ...removed,
        ...incoming.filter((tab) => !kept.includes(tab)).map(({ id }) => id),
      ]);
    const update: Partial<WorkspaceStore> = {
      layout: mergeTabs(state.layout, here, leaving(here)),
    };
    const asides: Record<string, AsideWorkspace> = { ...state.asides };
    let asidesChanged = false;
    const keys = new Set([
      ...Object.keys(asides),
      ...incoming.map(sideOfTab).filter((key): key is string => Boolean(key) && key !== state.side),
    ]);
    for (const key of keys) {
      const mine = incoming.filter((tab) => sideOfTab(tab) === key);
      const aside = asides[key] ?? emptyAsideWorkspace();
      const layout = mergeTabs(aside.layout, mine, leaving(mine));
      if (layout === aside.layout && asides[key]) continue;
      asides[key] = { ...aside, layout };
      asidesChanged = true;
    }
    if (asidesChanged) update.asides = asides;
    useWorkspaceStore.setState(update);
  };

  const sync = () =>
    inOrder(async () => {
      if (stopped) return;
      clearTimeout(timer);
      if (started) await publish();
      const result = await invoke<TabsForWindow>("profile_tabs_sync", { local: localTabIds() });
      if (stopped) return;
      apply(result);
      started = true;
      await publish();
    });

  const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
    if (state.layout === previous.layout && state.asides === previous.asides) return;
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
