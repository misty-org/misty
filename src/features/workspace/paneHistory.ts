import type { WorkspacePane, WorkspaceTab } from "./model";

export function paneHistory(pane: WorkspacePane) {
  const active = pane.tabs[0];
  const history = pane.history;
  if (!history?.entries.length) return { entries: active ? [active] : [], index: 0 };
  const index = Math.max(0, Math.min(history.index, history.entries.length - 1));
  const entries = [...history.entries];
  if (active) entries[index] = active;
  return { entries, index };
}

export function pushPaneView(
  pane: WorkspacePane,
  view: WorkspaceTab,
  replace = false,
): WorkspacePane {
  const history = paneHistory(pane);
  const entries = replace
    ? history.entries.map((entry, index) => (index === history.index ? view : entry))
    : [...history.entries.slice(0, history.index + 1), view];
  if (!entries.length) entries.push(view);
  return {
    ...pane,
    tabs: [view],
    activeTabId: view.id,
    history: { entries, index: replace ? history.index : entries.length - 1 },
  };
}

export function traversePaneHistory(pane: WorkspacePane, delta: number): WorkspacePane | null {
  const history = paneHistory(pane),
    index = history.index + delta;
  if (index < 0 || index >= history.entries.length) return null;
  const view = history.entries[index];
  return { ...pane, tabs: [view], activeTabId: view.id, history: { ...history, index } };
}
