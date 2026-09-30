import {
  recoverPaneHistoryViews,
  isEmptyTab,
  layoutTabs,
  mapLayoutViews,
  migrateTabs,
  activateTab,
} from "./layoutTabs";
import { reconcileGroupIdentities } from "./groupIdentity";
import {
  capDockLeaves,
  createDockLeaf,
  dockLeaves,
  fillEmptyDockLeaves,
  findDockLeaf,
  normalizeDockNode,
  removeDockLeaf,
} from "./dockTree";
import {
  maxWorkspacePanels,
  type WorkspaceLayout,
  type WorkspaceScopeKey,
  type WorkspaceWindow,
  type WorkspaceView,
} from "./model";
import { createDefaultWorkspaceView } from "./workspaceDefaultView";

export interface WorkspaceWindowsState {
  activeScopeKey: WorkspaceScopeKey;
  layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>>;
  windowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceWindow[]>>;
  activeWindowIdByScope: Partial<Record<WorkspaceScopeKey, string>>;
  activeWindowId: string;
  layout: WorkspaceLayout;
}

export type WorkspaceWindowsUpdate = Partial<WorkspaceWindowsState>;

export function initialWorkspaceLayout(scopeKey: WorkspaceScopeKey = "global"): WorkspaceLayout {
  const pane = createDockLeaf([createDefaultWorkspaceView(scopeKey)]);
  return { root: pane, focusedPaneId: pane.id };
}

export function normalizeWorkspaceLayout(
  layout: WorkspaceLayout,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceLayout {
  const migrated = recoverPaneHistoryViews(migrateTabs(layout));
  const activeId = migrated.activeTabId ?? layoutTabs(migrated)[0].id;
  // Having no tabs at all is a real state; only fill panes when other tabs exist.
  const noTabs = layoutTabs(migrated).every(isEmptyTab);
  const tabs = layoutTabs(migrated).map((tab) => {
    const source = tab.id === activeId ? migrated : tab;
    const root = normalizeDockNode(
      fillEmptyDockLeaves(
        capDockLeaves(source.root, maxWorkspacePanels),
        noTabs ? undefined : () => createDefaultWorkspaceView(scopeKey),
      ),
    );
    const panes = dockLeaves(root);
    const normalized = reconcileGroupIdentities({
      root,
      focusedPaneId: panes.some((pane) => pane.id === source.focusedPaneId)
        ? source.focusedPaneId
        : panes[0].id,
    });
    return { ...tab, ...normalized };
  });
  return activateTab({ ...migrated, tabs }, activeId);
}

export function createWorkspaceWindow(
  layout = initialWorkspaceLayout(),
  title = "Window 1",
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceWindow {
  const now = Date.now();
  return {
    id: `window:${now.toString(36)}:${Math.random().toString(36).slice(2, 9)}`,
    title,
    layout: normalizeWorkspaceLayout(layout, scopeKey),
    createdAt: now,
    lastFocusedAt: now,
  };
}

export function initialWorkspaceWindow(): WorkspaceWindowsState {
  const window = createWorkspaceWindow();
  return {
    activeScopeKey: "global",
    layout: window.layout,
    layoutsByScope: { global: window.layout },
    windowsByScope: { global: [window] },
    activeWindowIdByScope: { global: window.id },
    activeWindowId: window.id,
  };
}

export function currentWindows(state: WorkspaceWindowsState): WorkspaceWindow[] {
  const existing = state.windowsByScope[state.activeScopeKey];
  if (existing?.length) return existing;
  return [
    {
      id: state.activeWindowId,
      title: "Window 1",
      layout: state.layout,
      createdAt: Date.now(),
      lastFocusedAt: Date.now(),
    },
  ];
}

export function withActiveWindowLayout(
  state: WorkspaceWindowsState,
  layout: WorkspaceLayout,
): WorkspaceWindowsUpdate {
  const normalized = normalizeWorkspaceLayout(layout, state.activeScopeKey);
  return {
    layout: normalized,
    layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: normalized },
    windowsByScope: {
      ...state.windowsByScope,
      [state.activeScopeKey]: currentWindows(state).map((window) =>
        window.id === state.activeWindowId ? { ...window, layout: normalized } : window,
      ),
    },
  };
}

/** Transform every saved layout without changing the selected window. */
export function mapAllWorkspaceWindowLayouts(
  state: WorkspaceWindowsState,
  update: (layout: WorkspaceLayout) => WorkspaceLayout,
) {
  return {
    layout: update(state.layout),
    layoutsByScope: Object.fromEntries(
      Object.entries(state.layoutsByScope).map(([scope, layout]) => [
        scope,
        layout ? update(layout) : layout,
      ]),
    ) as WorkspaceWindowsState["layoutsByScope"],
    windowsByScope: Object.fromEntries(
      Object.entries(state.windowsByScope).map(([scope, windows]) => [
        scope,
        windows?.map((window) => ({ ...window, layout: update(window.layout) })),
      ]),
    ) as WorkspaceWindowsState["windowsByScope"],
  };
}

/** Applies tab-owned async state even when its virtual window or scope is inactive. */
export function mapAllWorkspaceWindowViews(
  state: WorkspaceWindowsState,
  update: (tab: WorkspaceView) => WorkspaceView,
): Pick<WorkspaceWindowsState, "layout" | "layoutsByScope" | "windowsByScope"> {
  const mapLayout = (layout: WorkspaceLayout): WorkspaceLayout => mapLayoutViews(layout, update);
  return {
    layout: mapLayout(state.layout),
    layoutsByScope: Object.fromEntries(
      Object.entries(state.layoutsByScope).map(([scope, layout]) => [
        scope,
        layout ? mapLayout(layout) : layout,
      ]),
    ) as WorkspaceWindowsState["layoutsByScope"],
    windowsByScope: Object.fromEntries(
      Object.entries(state.windowsByScope).map(([scope, windows]) => [
        scope,
        windows?.map((window) => ({ ...window, layout: mapLayout(window.layout) })),
      ]),
    ) as WorkspaceWindowsState["windowsByScope"],
  };
}

export function switchWorkspaceScope(
  state: WorkspaceWindowsState,
  scopeKey: WorkspaceScopeKey,
): WorkspaceWindowsUpdate | null {
  if (state.activeScopeKey === scopeKey) return null;
  const layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>> = {
    ...state.layoutsByScope,
    [state.activeScopeKey]: state.layout,
  };
  const windows = state.windowsByScope[scopeKey] ?? [
    createWorkspaceWindow(
      layoutsByScope[scopeKey] ?? initialWorkspaceLayout(scopeKey),
      undefined,
      scopeKey,
    ),
  ];
  const requestedId = state.activeWindowIdByScope[scopeKey] ?? windows[0].id;
  const active = windows.find((window) => window.id === requestedId) ?? windows[0];
  const layout = normalizeWorkspaceLayout(active.layout, scopeKey);
  return {
    activeScopeKey: scopeKey,
    activeWindowId: active.id,
    layout,
    layoutsByScope: { ...layoutsByScope, [scopeKey]: layout },
    windowsByScope: { ...state.windowsByScope, [scopeKey]: windows },
    activeWindowIdByScope: {
      ...state.activeWindowIdByScope,
      [scopeKey]: active.id,
    },
  };
}

export function adoptDefaultWorkspaceScope(
  state: WorkspaceWindowsState,
  scopeKey: WorkspaceScopeKey,
  validScopes?: Set<string>,
): WorkspaceWindowsUpdate | null {
  const needsAdoption =
    state.activeScopeKey === "global" ||
    (validScopes !== undefined && !validScopes.has(state.activeScopeKey));
  if (!needsAdoption) return null;
  const layoutsByScope = { ...state.layoutsByScope };
  const virtualWindowsByScope = { ...state.windowsByScope };
  const activeIds = { ...state.activeWindowIdByScope };
  const windows = virtualWindowsByScope[scopeKey] ??
    virtualWindowsByScope.global ?? [
      createWorkspaceWindow(
        layoutsByScope[scopeKey] ?? initialWorkspaceLayout(scopeKey),
        undefined,
        scopeKey,
      ),
    ];
  const requestedId = activeIds[scopeKey] ?? windows[0].id;
  const active = windows.find((window) => window.id === requestedId) ?? windows[0];
  const layout = normalizeWorkspaceLayout(active.layout, scopeKey);
  delete layoutsByScope.global;
  delete virtualWindowsByScope.global;
  delete activeIds.global;
  return {
    activeScopeKey: scopeKey,
    activeWindowId: active.id,
    layout,
    layoutsByScope: { ...layoutsByScope, [scopeKey]: layout },
    windowsByScope: { ...virtualWindowsByScope, [scopeKey]: windows },
    activeWindowIdByScope: { ...activeIds, [scopeKey]: active.id },
  };
}

export function addWindow(state: WorkspaceWindowsState, title?: string) {
  const windows = currentWindows(state);
  const window = createWorkspaceWindow(
    initialWorkspaceLayout(state.activeScopeKey),
    title?.trim() || `Window ${windows.length + 1}`,
    state.activeScopeKey,
  );
  return { window, update: activateWindowUpdate(state, [...windows, window], window) };
}

export function switchWindow(
  state: WorkspaceWindowsState,
  windowId: string,
): WorkspaceWindowsUpdate | null {
  if (windowId === state.activeWindowId) return {};
  const windows = currentWindows(state);
  const target = windows.find((window) => window.id === windowId);
  if (!target) return null;
  const focused = { ...target, lastFocusedAt: Date.now() };
  return activateWindowUpdate(
    state,
    windows.map((window) => (window.id === target.id ? focused : window)),
    focused,
  );
}

export function closeWindow(
  state: WorkspaceWindowsState,
  windowId: string,
): WorkspaceWindowsUpdate | null {
  const windows = currentWindows(state);
  if (windows.length <= 1 || !windows.some((window) => window.id === windowId)) return null;
  const remaining = windows.filter((window) => window.id !== windowId);
  const active =
    windowId === state.activeWindowId
      ? [...remaining].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0]
      : windows.find((window) => window.id === state.activeWindowId)!;
  return activateWindowUpdate(state, remaining, active);
}

export function restoreWindow(
  state: WorkspaceWindowsState,
  workspaceWindow: WorkspaceWindow,
): WorkspaceWindowsUpdate {
  const windows = currentWindows(state).filter((candidate) => candidate.id !== workspaceWindow.id);
  const restored = {
    ...workspaceWindow,
    layout: normalizeWorkspaceLayout(workspaceWindow.layout, state.activeScopeKey),
    lastFocusedAt: Date.now(),
  };
  return activateWindowUpdate(state, [...windows, restored], restored);
}

export function extractPaneToWindow(state: WorkspaceWindowsState, paneId: string) {
  const pane = findDockLeaf(state.layout.root, paneId);
  if (!pane) return null;
  const windows = currentWindows(state);
  const activeTab = pane.views.find((tab) => tab.id === pane.activeViewId) ?? pane.views[0];
  const window = createWorkspaceWindow(
    { root: pane, focusedPaneId: pane.id },
    activeTab?.title || `Window ${windows.length + 1}`,
    state.activeScopeKey,
  );
  const sourceRoot = removeDockLeaf(state.layout.root, paneId) ?? createDockLeaf([]);
  const sourceLayout = normalizeWorkspaceLayout(
    {
      ...state.layout,
      root: sourceRoot,
      focusedPaneId: dockLeaves(sourceRoot)[0].id,
    },
    state.activeScopeKey,
  );
  const nextWindows = windows
    .map((candidate) =>
      candidate.id === state.activeWindowId ? { ...candidate, layout: sourceLayout } : candidate,
    )
    .concat(window);
  return { window, update: activateWindowUpdate(state, nextWindows, window) };
}

export function renameWindow(
  state: WorkspaceWindowsState,
  windowId: string,
  title: string,
): WorkspaceWindowsUpdate | null {
  const nextTitle = title.trim();
  if (!nextTitle) return null;
  return {
    windowsByScope: {
      ...state.windowsByScope,
      [state.activeScopeKey]: currentWindows(state).map((window) =>
        window.id === windowId ? { ...window, title: nextTitle } : window,
      ),
    },
  };
}

function activateWindowUpdate(
  state: WorkspaceWindowsState,
  windows: WorkspaceWindow[],
  active: WorkspaceWindow,
): WorkspaceWindowsUpdate {
  const layout = normalizeWorkspaceLayout(active.layout, state.activeScopeKey);
  return {
    activeWindowId: active.id,
    activeWindowIdByScope: {
      ...state.activeWindowIdByScope,
      [state.activeScopeKey]: active.id,
    },
    windowsByScope: {
      ...state.windowsByScope,
      [state.activeScopeKey]: windows,
    },
    layout,
    layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: layout },
  };
}
