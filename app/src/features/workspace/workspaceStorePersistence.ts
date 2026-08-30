import type { WorkspaceStore } from "./useWorkspaceStore";
import {
  createWorkspaceVirtualWindow,
  initialWorkspaceLayout,
  normalizeWorkspaceLayout,
} from "./virtualWindows";
import {
  migrateRetiredWorkspaceTab,
  migrateRetiredWorkspaceTabs,
  migrateSpaceToolTabs,
} from "./workspaceMigrations";
import { migrateClosedWorkspaceTabs } from "./closedWorkspaceTabs";
import type { WorkspaceScopeKey, WorkspaceVirtualWindow } from "./model";

export function migrateWorkspaceStore(persisted: unknown, version: number): WorkspaceStore {
  const state = persisted as Partial<WorkspaceStore> | undefined;
  if (!state) return state as unknown as WorkspaceStore;

  let migrated: Partial<WorkspaceStore> = state;
  if (version >= 6) {
    migrated = state;
  } else if (version >= 5) {
    migrated = { ...state, closedTabs: migrateClosedWorkspaceTabs(state.closedTabs) };
  } else if (version >= 4) {
    migrated = {
      ...state,
      closedTabs: migrateClosedWorkspaceTabs(state.closedTabs),
      closedVirtualWindowsByScope: {},
    };
  } else {
    const layoutsByScope = Object.fromEntries(
      Object.entries(state.layoutsByScope ?? {}).map(([scope, layout]) => [
        scope,
        layout ? normalizeWorkspaceLayout(migrateSpaceToolTabs(layout)) : layout,
      ]),
    ) as WorkspaceStore["layoutsByScope"];
    const activeScopeKey = state.activeScopeKey ?? "global";
    const activeLayout = normalizeWorkspaceLayout(
      migrateSpaceToolTabs(
        state.layout ?? layoutsByScope[activeScopeKey] ?? initialWorkspaceLayout(),
      ),
    );
    layoutsByScope[activeScopeKey] = activeLayout;
    const virtualWindowsByScope = Object.fromEntries(
      Object.entries(layoutsByScope).flatMap(([scope, layout]) =>
        layout ? [[scope, [createWorkspaceVirtualWindow(layout)]]] : [],
      ),
    ) as WorkspaceStore["virtualWindowsByScope"];
    const activeVirtualWindowIdByScope = Object.fromEntries(
      Object.entries(virtualWindowsByScope).map(([scope, windows]) => [scope, windows?.[0]?.id]),
    ) as WorkspaceStore["activeVirtualWindowIdByScope"];
    migrated = {
      ...state,
      activeScopeKey,
      layout: activeLayout,
      layoutsByScope,
      virtualWindowsByScope,
      activeVirtualWindowIdByScope,
      activeVirtualWindowId: activeVirtualWindowIdByScope[activeScopeKey]!,
      closedTabs: migrateClosedWorkspaceTabs(state.closedTabs),
      closedVirtualWindowsByScope: {},
    };
  }

  return sanitizeRetiredWorkspaceSurfaces(migrated) as WorkspaceStore;
}

function sanitizeRetiredWorkspaceSurfaces(state: Partial<WorkspaceStore>): Partial<WorkspaceStore> {
  const activeScopeKey = state.activeScopeKey ?? "global";
  const migrateLayout = (layout: WorkspaceStore["layout"], scopeKey: WorkspaceScopeKey) =>
    normalizeWorkspaceLayout(migrateSpaceToolTabs(migrateRetiredWorkspaceTabs(layout, scopeKey)));
  const migrateWindows = (
    windows: WorkspaceVirtualWindow[] | undefined,
    scopeKey: WorkspaceScopeKey,
  ) => windows?.map((window) => ({ ...window, layout: migrateLayout(window.layout, scopeKey) }));

  const layoutsByScope = Object.fromEntries(
    Object.entries(state.layoutsByScope ?? {}).map(([scope, layout]) => [
      scope,
      layout ? migrateLayout(layout, scope as WorkspaceScopeKey) : layout,
    ]),
  ) as WorkspaceStore["layoutsByScope"];
  const virtualWindowsByScope = Object.fromEntries(
    Object.entries(state.virtualWindowsByScope ?? {}).map(([scope, windows]) => [
      scope,
      migrateWindows(windows, scope as WorkspaceScopeKey),
    ]),
  ) as WorkspaceStore["virtualWindowsByScope"];
  const closedVirtualWindowsByScope = Object.fromEntries(
    Object.entries(state.closedVirtualWindowsByScope ?? {}).map(([scope, windows]) => [
      scope,
      migrateWindows(windows, scope as WorkspaceScopeKey),
    ]),
  ) as WorkspaceStore["closedVirtualWindowsByScope"];

  return {
    ...state,
    activeScopeKey,
    layout: state.layout ? migrateLayout(state.layout, activeScopeKey) : state.layout,
    layoutsByScope,
    virtualWindowsByScope,
    closedVirtualWindowsByScope,
    closedTabs: migrateClosedWorkspaceTabs(state.closedTabs).map((closed) => ({
      ...closed,
      tab: migrateRetiredWorkspaceTab(closed.tab, activeScopeKey),
    })),
  };
}

export function partialWorkspaceStore(state: WorkspaceStore): Partial<WorkspaceStore> {
  return {
    activeScopeKey: state.activeScopeKey,
    layout: state.layout,
    layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: state.layout },
    virtualWindowsByScope: state.virtualWindowsByScope,
    activeVirtualWindowIdByScope: state.activeVirtualWindowIdByScope,
    activeVirtualWindowId: state.activeVirtualWindowId,
    lastUsedTabByGroup: state.lastUsedTabByGroup,
    closedTabs: state.closedTabs,
    closedVirtualWindowsByScope: state.closedVirtualWindowsByScope,
  };
}
