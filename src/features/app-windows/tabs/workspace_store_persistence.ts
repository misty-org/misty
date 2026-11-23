import { layoutTabs } from "../panes/layout_tabs";
import type { WorkspaceLayout } from "./workspace_views";
import type { WorkspaceStore } from "./use_workspace_store";
import {
  initialWorkspaceLayout,
  initialWorkspaceWindow,
  normalizeWorkspaceLayout,
} from "../profiles/windows";
import {
  knownWorkspacePane,
  knownWorkspaceTab,
  knownWorkspaceView,
  withKnownWorkspaceViews,
} from "../recovery/known_workspace_views";
import type { ClosedWorkspaceItem } from "./closed_workspace_items";
import { currentWindowId } from "../profiles/profile_window";
import { browserWorkspaceStoreVersion } from "../recovery/workspace_recovery_storage";
import type { AsideWorkspace } from "./workspace_sides";

const knownLayout = (layout: WorkspaceLayout) =>
  normalizeWorkspaceLayout(withKnownWorkspaceViews(layout));

function knownClosedItems(value: unknown): ClosedWorkspaceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((closed: ClosedWorkspaceItem | null) => {
    if (!closed || typeof closed !== "object") return [];
    const view = knownWorkspaceView(closed.view);
    if (!view) return [];
    const { tab: closedTab, pane: closedPane, ...rest } = closed;
    const tab = closedTab ? knownWorkspaceTab(closedTab) : null;
    if (closedTab && !tab) return [];
    const pane = closedPane ? knownWorkspacePane(closedPane) : undefined;
    return [
      {
        ...rest,
        view,
        ...(pane ? { pane } : {}),
        ...(tab
          ? { tab: layoutTabs(knownLayout({ ...tab, tabs: [tab], activeTabId: tab.id }))[0] }
          : {}),
      },
    ];
  });
}

function knownSide(value: unknown): WorkspaceStore["side"] {
  return value === "personal" || value === "spaces" ? value : undefined;
}

function knownAside(value: unknown): AsideWorkspace | undefined {
  const aside = value as Partial<AsideWorkspace> | null | undefined;
  if (!aside || typeof aside !== "object" || !aside.layout) return undefined;
  return {
    layout: knownLayout(aside.layout),
    lastUsedViewByGroup:
      aside.lastUsedViewByGroup && typeof aside.lastUsedViewByGroup === "object"
        ? aside.lastUsedViewByGroup
        : {},
    closedItems: knownClosedItems(aside.closedItems),
  };
}

export function migrateWorkspaceStore(persisted: unknown, version: number): WorkspaceStore {
  const state = persisted as Partial<WorkspaceStore> | null | undefined;
  if (version < browserWorkspaceStoreVersion || !state || typeof state !== "object") {
    const fresh: Partial<WorkspaceStore> = {
      ...initialWorkspaceWindow(),
      lastUsedViewByGroup: {},
      closedItems: [],
    };
    return fresh as WorkspaceStore;
  }
  return {
    ...state,
    layout: knownLayout(state.layout ?? initialWorkspaceLayout()),
    activeWindowId: currentWindowId(),
    closedItems: knownClosedItems(state.closedItems),
    side: knownSide(state.side),
    aside: knownSide(state.side) ? knownAside(state.aside) : undefined,
  } as WorkspaceStore;
}

export function partialWorkspaceStore(state: WorkspaceStore): Partial<WorkspaceStore> {
  return {
    layout: state.layout,
    activeWindowId: state.activeWindowId,
    dockingLayout: state.dockingLayout,
    lastUsedViewByGroup: state.lastUsedViewByGroup,
    closedItems: state.closedItems,
    side: state.side,
    aside: state.aside,
  };
}
