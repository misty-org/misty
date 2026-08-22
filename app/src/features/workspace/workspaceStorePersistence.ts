import type { WorkspaceStore } from "./useWorkspaceStore";
import {
  createWorkspaceVirtualWindow,
  initialWorkspaceLayout,
  normalizeWorkspaceLayout,
} from "./virtualWindows";
import { migrateSpaceToolTabs } from "./workspaceMigrations";
import { migrateClosedWorkspaceTabs } from "./closedWorkspaceTabs";

export function migrateWorkspaceStore(persisted: unknown, version: number): WorkspaceStore {
  const state = persisted as Partial<WorkspaceStore> | undefined;
  if (!state || version >= 6) return state as WorkspaceStore;
  if (version >= 5)
    return { ...state, closedTabs: migrateClosedWorkspaceTabs(state.closedTabs) } as WorkspaceStore;
  if (version >= 4)
    return {
      ...state,
      closedTabs: migrateClosedWorkspaceTabs(state.closedTabs),
      closedVirtualWindowsByScope: {},
    } as WorkspaceStore;
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
  return {
    ...state,
    activeScopeKey,
    layout: activeLayout,
    layoutsByScope,
    virtualWindowsByScope,
    activeVirtualWindowIdByScope,
    activeVirtualWindowId: activeVirtualWindowIdByScope[activeScopeKey]!,
    closedTabs: migrateClosedWorkspaceTabs(state.closedTabs),
    closedVirtualWindowsByScope: {},
  } as WorkspaceStore;
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
