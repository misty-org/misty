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
  normalizeDockNode,
} from "./dockTree";
import {
  maxWorkspacePanes,
  type WorkspaceLayout,
  type WorkspaceScopeKey,
  type WorkspaceWindow,
  type WorkspaceView,
} from "./model";
import { createDefaultWorkspaceView } from "./workspaceDefaultView";
import { useSpaceWindowStore, windowSpaceScope } from "./spaceWindow";
import type { DockingLayout } from "@/features/app-shell/dockingLayout";

/**
 * One renderer runs one OS window, which shows one Space at a time. The Space on screen
 * is `activeScopeKey`, its tabs and panes are `layout`, and `activeWindowId` is the
 * window's identity in that Space's sync tree (window → tab → pane → view). Every Space
 * the window has shown keeps its layout in `layoutsByScope` and its window identity in
 * `windowIdsByScope`, so switching back restores them.
 */
export interface WorkspaceWindowsState {
  activeScopeKey: WorkspaceScopeKey;
  layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>>;
  windowIdsByScope?: Partial<Record<WorkspaceScopeKey, string>>;
  activeWindowId: string;
  layout: WorkspaceLayout;
  /** Where this window keeps its navigation and tabs; the device default when unset. */
  dockingLayout?: DockingLayout;
}

export type WorkspaceWindowsUpdate = Partial<WorkspaceWindowsState>;

export function initialWorkspaceLayout(
  scopeKey: WorkspaceScopeKey = windowSpaceScope(),
): WorkspaceLayout {
  const pane = createDockLeaf([createDefaultWorkspaceView(scopeKey)]);
  return { root: pane, focusedPaneId: pane.id };
}

export function normalizeWorkspaceLayout(
  layout: WorkspaceLayout,
  scopeKey: WorkspaceScopeKey = windowSpaceScope(),
): WorkspaceLayout {
  const migrated = recoverPaneHistoryViews(migrateTabs(layout));
  const activeId = migrated.activeTabId ?? layoutTabs(migrated)[0].id;
  // Having no tabs at all is a real state; only fill panes when other tabs exist.
  const noTabs = layoutTabs(migrated).every(isEmptyTab);
  const tabs = layoutTabs(migrated).map((tab) => {
    const source = tab.id === activeId ? migrated : tab;
    const root = normalizeDockNode(
      fillEmptyDockLeaves(
        capDockLeaves(source.root, maxWorkspacePanes),
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

/** A new identity for this OS window in the sync tree. */
export function createWorkspaceWindowId(): string {
  return `window:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
}

export function initialWorkspaceWindow(): WorkspaceWindowsState {
  const scope = windowSpaceScope();
  const layout = normalizeWorkspaceLayout(initialWorkspaceLayout(scope), scope);
  return {
    activeScopeKey: scope,
    layout,
    layoutsByScope: { [scope]: layout },
    activeWindowId: createWorkspaceWindowId(),
  };
}

/** This OS window as the sync tree and agents see it, tinted with its Space's color. */
export function currentWindow(state: WorkspaceWindowsState): WorkspaceWindow {
  const space = useSpaceWindowStore.getState().space;
  return {
    id: state.activeWindowId,
    title: space?.name ?? "Window",
    ...(space?.color ? { color: space.color } : {}),
    ...(state.dockingLayout ? { dockingLayout: state.dockingLayout } : {}),
    layout: state.layout,
    createdAt: 0,
    lastFocusedAt: 0,
  };
}

/** The Space's own layout, even while a device profile's is on screen. */
export function spaceLayout(state: WorkspaceWindowsState): WorkspaceLayout {
  const scope = windowSpaceScope();
  return state.activeScopeKey === scope
    ? state.layout
    : (state.layoutsByScope[scope] ?? initialWorkspaceLayout(scope));
}

/** The windows this renderer holds: always its one OS window. */
export function currentWindows(state: WorkspaceWindowsState): WorkspaceWindow[] {
  return [currentWindow(state)];
}

export function withActiveWindowLayout(
  state: WorkspaceWindowsState,
  layout: WorkspaceLayout,
): WorkspaceWindowsUpdate {
  const normalized = normalizeWorkspaceLayout(layout, state.activeScopeKey);
  return {
    layout: normalized,
    layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: normalized },
  };
}

/** Transform every saved layout without changing the one on screen's scope. */
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
  };
}

/** Applies tab-owned async state even when its scope is not on screen. */
export function mapAllWorkspaceWindowViews(
  state: WorkspaceWindowsState,
  update: (tab: WorkspaceView) => WorkspaceView,
): Pick<WorkspaceWindowsState, "layout" | "layoutsByScope"> {
  return mapAllWorkspaceWindowLayouts(state, (layout) => mapLayoutViews(layout, update));
}

/** Shows another scope's layout in this window (a device profile, or back to the Space). */
function switchWorkspaceScope(
  state: WorkspaceWindowsState,
  scopeKey: WorkspaceScopeKey,
): WorkspaceWindowsUpdate | null {
  if (state.activeScopeKey === scopeKey) return null;
  const layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>> = {
    ...state.layoutsByScope,
    [state.activeScopeKey]: state.layout,
  };
  const layout = normalizeWorkspaceLayout(
    layoutsByScope[scopeKey] ?? initialWorkspaceLayout(scopeKey),
    scopeKey,
  );
  return {
    activeScopeKey: scopeKey,
    layout,
    layoutsByScope: { ...layoutsByScope, [scopeKey]: layout },
  };
}

/** Shows another Space in this window: its own tabs, and its own window in its sync tree. */
export function showSpaceScope(
  state: WorkspaceWindowsState,
  scopeKey: WorkspaceScopeKey,
): WorkspaceWindowsUpdate | null {
  const update = switchWorkspaceScope(state, scopeKey);
  if (!update) return null;
  const windowIdsByScope: Partial<Record<WorkspaceScopeKey, string>> = {
    ...state.windowIdsByScope,
    [state.activeScopeKey]: state.activeWindowId,
  };
  const activeWindowId = windowIdsByScope[scopeKey] ?? createWorkspaceWindowId();
  return {
    ...update,
    windowIdsByScope: { ...windowIdsByScope, [scopeKey]: activeWindowId },
    activeWindowId,
  };
}
