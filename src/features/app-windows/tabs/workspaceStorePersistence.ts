import { layoutTabs } from "../panes/layoutTabs";
import type { WorkspaceLayout } from "./workspaceViews";
import type { WorkspaceStore } from "./useWorkspaceStore";
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
} from "../recovery/knownWorkspaceViews";
import type { ClosedWorkspaceItem } from "./closedWorkspaceItems";
import { currentWindowId } from "../profiles/profileWindow";
import { browserWorkspaceStoreVersion } from "../recovery/workspaceRecoveryStorage";

const knownLayout = (layout: WorkspaceLayout) =>
  normalizeWorkspaceLayout(withKnownWorkspaceViews(layout));

/** What a window reopens of what it closed, with only the views this build shows. */
function knownClosedItems(value: unknown): ClosedWorkspaceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((closed: ClosedWorkspaceItem | null) => {
    if (!closed || typeof closed !== "object") return [];
    const view = knownWorkspaceView(closed.view);
    if (!view) return [];
    const { tab: closedTab, pane: closedPane, ...rest } = closed;
    const tab = closedTab ? knownWorkspaceTab(closedTab) : null;
    // A closed tab that held nothing this build shows has nothing to reopen.
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

/**
 * A window's saved state as this version reads it. Every load path (storage, native recovery,
 * account switch) comes through here. A record from an older store version isn't converted: the
 * window starts fresh instead. The window's id comes from the native window.
 */
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
  } as WorkspaceStore;
}

/** What a window saves: its tabs and panes, and what it closed. */
export function partialWorkspaceStore(state: WorkspaceStore): Partial<WorkspaceStore> {
  return {
    layout: state.layout,
    activeWindowId: state.activeWindowId,
    dockingLayout: state.dockingLayout,
    lastUsedViewByGroup: state.lastUsedViewByGroup,
    closedItems: state.closedItems,
  };
}
