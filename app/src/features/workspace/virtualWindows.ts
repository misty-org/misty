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
  type WorkspaceVirtualWindow,
} from "./model";

export interface VirtualWorkspaceState {
  activeScopeKey: WorkspaceScopeKey;
  layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>>;
  virtualWindowsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceVirtualWindow[]>>;
  activeVirtualWindowIdByScope: Partial<Record<WorkspaceScopeKey, string>>;
  activeVirtualWindowId: string;
  layout: WorkspaceLayout;
}

export type VirtualWorkspaceUpdate = Partial<VirtualWorkspaceState>;

export function initialWorkspaceLayout(_scopeKey: WorkspaceScopeKey = "global"): WorkspaceLayout {
  const pane = createDockLeaf([]);
  return { root: pane, focusedPaneId: pane.id };
}

export function normalizeWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const root = normalizeDockNode(
    fillEmptyDockLeaves(capDockLeaves(layout.root, maxWorkspacePanels)),
  );
  const panes = dockLeaves(root);
  return {
    root,
    focusedPaneId: panes.some((pane) => pane.id === layout.focusedPaneId)
      ? layout.focusedPaneId
      : panes[0].id,
  };
}

export function createWorkspaceVirtualWindow(
  layout = initialWorkspaceLayout(),
  title = "Window 1",
): WorkspaceVirtualWindow {
  const now = Date.now();
  return {
    id: `window:${now.toString(36)}:${Math.random().toString(36).slice(2, 9)}`,
    title,
    layout: normalizeWorkspaceLayout(layout),
    createdAt: now,
    lastFocusedAt: now,
  };
}

export function initialVirtualWorkspace(): VirtualWorkspaceState {
  const window = createWorkspaceVirtualWindow();
  return {
    activeScopeKey: "global",
    layout: window.layout,
    layoutsByScope: { global: window.layout },
    virtualWindowsByScope: { global: [window] },
    activeVirtualWindowIdByScope: { global: window.id },
    activeVirtualWindowId: window.id,
  };
}

export function currentVirtualWindows(state: VirtualWorkspaceState): WorkspaceVirtualWindow[] {
  const existing = state.virtualWindowsByScope[state.activeScopeKey];
  if (existing?.length) return existing;
  return [
    {
      id: state.activeVirtualWindowId,
      title: "Window 1",
      layout: state.layout,
      createdAt: Date.now(),
      lastFocusedAt: Date.now(),
    },
  ];
}

export function withActiveVirtualWindowLayout(
  state: VirtualWorkspaceState,
  layout: WorkspaceLayout,
): VirtualWorkspaceUpdate {
  const normalized = normalizeWorkspaceLayout(layout);
  return {
    layout: normalized,
    layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: normalized },
    virtualWindowsByScope: {
      ...state.virtualWindowsByScope,
      [state.activeScopeKey]: currentVirtualWindows(state).map((window) =>
        window.id === state.activeVirtualWindowId ? { ...window, layout: normalized } : window,
      ),
    },
  };
}

export function switchWorkspaceScope(
  state: VirtualWorkspaceState,
  scopeKey: WorkspaceScopeKey,
): VirtualWorkspaceUpdate | null {
  if (state.activeScopeKey === scopeKey) return null;
  const layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>> = {
    ...state.layoutsByScope,
    [state.activeScopeKey]: state.layout,
  };
  const windows = state.virtualWindowsByScope[scopeKey] ?? [
    createWorkspaceVirtualWindow(layoutsByScope[scopeKey] ?? initialWorkspaceLayout(scopeKey)),
  ];
  const requestedId = state.activeVirtualWindowIdByScope[scopeKey] ?? windows[0].id;
  const active = windows.find((window) => window.id === requestedId) ?? windows[0];
  const layout = normalizeWorkspaceLayout(active.layout);
  return {
    activeScopeKey: scopeKey,
    activeVirtualWindowId: active.id,
    layout,
    layoutsByScope: { ...layoutsByScope, [scopeKey]: layout },
    virtualWindowsByScope: { ...state.virtualWindowsByScope, [scopeKey]: windows },
    activeVirtualWindowIdByScope: {
      ...state.activeVirtualWindowIdByScope,
      [scopeKey]: active.id,
    },
  };
}

export function adoptDefaultWorkspaceScope(
  state: VirtualWorkspaceState,
  scopeKey: WorkspaceScopeKey,
): VirtualWorkspaceUpdate | null {
  if (state.activeScopeKey !== "global") return null;
  const layoutsByScope = { ...state.layoutsByScope };
  const virtualWindowsByScope = { ...state.virtualWindowsByScope };
  const activeIds = { ...state.activeVirtualWindowIdByScope };
  const windows = virtualWindowsByScope[scopeKey] ??
    virtualWindowsByScope.global ?? [
      createWorkspaceVirtualWindow(layoutsByScope[scopeKey] ?? initialWorkspaceLayout(scopeKey)),
    ];
  const requestedId = activeIds[scopeKey] ?? windows[0].id;
  const active = windows.find((window) => window.id === requestedId) ?? windows[0];
  const layout = normalizeWorkspaceLayout(active.layout);
  delete layoutsByScope.global;
  delete virtualWindowsByScope.global;
  delete activeIds.global;
  return {
    activeScopeKey: scopeKey,
    activeVirtualWindowId: active.id,
    layout,
    layoutsByScope: { ...layoutsByScope, [scopeKey]: layout },
    virtualWindowsByScope: { ...virtualWindowsByScope, [scopeKey]: windows },
    activeVirtualWindowIdByScope: { ...activeIds, [scopeKey]: active.id },
  };
}

export function addVirtualWindow(state: VirtualWorkspaceState, title?: string) {
  const windows = currentVirtualWindows(state);
  const window = createWorkspaceVirtualWindow(
    initialWorkspaceLayout(state.activeScopeKey),
    title?.trim() || `Window ${windows.length + 1}`,
  );
  return { window, update: activateWindowUpdate(state, [...windows, window], window) };
}

export function switchVirtualWindow(
  state: VirtualWorkspaceState,
  windowId: string,
): VirtualWorkspaceUpdate | null {
  if (windowId === state.activeVirtualWindowId) return {};
  const windows = currentVirtualWindows(state);
  const target = windows.find((window) => window.id === windowId);
  if (!target) return null;
  const focused = { ...target, lastFocusedAt: Date.now() };
  return activateWindowUpdate(
    state,
    windows.map((window) => (window.id === target.id ? focused : window)),
    focused,
  );
}

export function closeVirtualWindow(
  state: VirtualWorkspaceState,
  windowId: string,
): VirtualWorkspaceUpdate | null {
  const windows = currentVirtualWindows(state);
  if (windows.length <= 1 || !windows.some((window) => window.id === windowId)) return null;
  const remaining = windows.filter((window) => window.id !== windowId);
  const active =
    windowId === state.activeVirtualWindowId
      ? [...remaining].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0]
      : windows.find((window) => window.id === state.activeVirtualWindowId)!;
  return activateWindowUpdate(state, remaining, active);
}

export function restoreVirtualWindow(
  state: VirtualWorkspaceState,
  workspaceWindow: WorkspaceVirtualWindow,
): VirtualWorkspaceUpdate {
  const windows = currentVirtualWindows(state).filter(
    (candidate) => candidate.id !== workspaceWindow.id,
  );
  const restored = {
    ...workspaceWindow,
    layout: normalizeWorkspaceLayout(workspaceWindow.layout),
    lastFocusedAt: Date.now(),
  };
  return activateWindowUpdate(state, [...windows, restored], restored);
}

export function extractPaneToVirtualWindow(state: VirtualWorkspaceState, paneId: string) {
  const pane = findDockLeaf(state.layout.root, paneId);
  if (!pane) return null;
  const windows = currentVirtualWindows(state);
  const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
  const window = createWorkspaceVirtualWindow(
    { root: pane, focusedPaneId: pane.id },
    activeTab?.title || `Window ${windows.length + 1}`,
  );
  const sourceRoot = removeDockLeaf(state.layout.root, paneId) ?? createDockLeaf([]);
  const sourceLayout = normalizeWorkspaceLayout({
    root: sourceRoot,
    focusedPaneId: dockLeaves(sourceRoot)[0].id,
  });
  const nextWindows = windows
    .map((candidate) =>
      candidate.id === state.activeVirtualWindowId
        ? { ...candidate, layout: sourceLayout }
        : candidate,
    )
    .concat(window);
  return { window, update: activateWindowUpdate(state, nextWindows, window) };
}

export function renameVirtualWindow(
  state: VirtualWorkspaceState,
  windowId: string,
  title: string,
): VirtualWorkspaceUpdate | null {
  const nextTitle = title.trim();
  if (!nextTitle) return null;
  return {
    virtualWindowsByScope: {
      ...state.virtualWindowsByScope,
      [state.activeScopeKey]: currentVirtualWindows(state).map((window) =>
        window.id === windowId ? { ...window, title: nextTitle } : window,
      ),
    },
  };
}

function activateWindowUpdate(
  state: VirtualWorkspaceState,
  windows: WorkspaceVirtualWindow[],
  active: WorkspaceVirtualWindow,
): VirtualWorkspaceUpdate {
  const layout = normalizeWorkspaceLayout(active.layout);
  return {
    activeVirtualWindowId: active.id,
    activeVirtualWindowIdByScope: {
      ...state.activeVirtualWindowIdByScope,
      [state.activeScopeKey]: active.id,
    },
    virtualWindowsByScope: {
      ...state.virtualWindowsByScope,
      [state.activeScopeKey]: windows,
    },
    layout,
    layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: layout },
  };
}
