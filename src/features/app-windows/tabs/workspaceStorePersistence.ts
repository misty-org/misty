import { layoutTabs } from "../panes/layoutTabs";
import type { WorkspaceLayout, WorkspaceTab, WorkspaceWindow } from "./workspaceViews";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { initialWorkspaceLayout, normalizeWorkspaceLayout } from "../profiles/windows";
import {
  migrateRetiredWorkspacePane,
  migrateRetiredWorkspaceTab,
  migrateRetiredWorkspaceView,
  migrateRetiredWorkspaceViews,
} from "../recovery/workspaceMigrations";
import { migrateClosedWorkspaceItems } from "./closedWorkspaceItems";
import { upgradeWorkspaceShape } from "../recovery/workspaceShapeUpgrade";
import { currentWindowId } from "../profiles/profileWindow";
import { eraseRetiredBrowserProfiles } from "../recovery/retiredBrowserProfiles";

/** Saved state from before a window had one layout: one per Space, and before that virtual
 * windows per scope, with a `global` scope for the default workspace. */
type LegacyLayouts = {
  activeScopeKey?: string;
  layoutsByScope?: Partial<Record<string, WorkspaceLayout>>;
  windowIdsByScope?: unknown;
  windowsByScope?: Partial<Record<string, WorkspaceWindow[]>>;
  activeWindowIdByScope?: Partial<Record<string, string>>;
  closedWindowsByScope?: unknown;
  browserProfiles?: unknown;
};

/** What a window saved for a person's own browsing, before version 19: tab groups, bookmarks and
 * their folders. None of it is read any more; a load drops it. */
type RetiredBrowsing = {
  tabGroups?: unknown;
  migratedTabGroupIds?: unknown;
  bookmarkFolders?: unknown;
  bookmarks?: unknown;
  expandedBookmarkFolders?: unknown;
  selectedBookmarkByFolder?: unknown;
};

/** A tab without the group and the pinned page it could have before version 19. */
function plainTab(tab: WorkspaceTab): WorkspaceTab {
  if (!tab || typeof tab !== "object" || !("tabGroupId" in tab || "pinnedUrl" in tab)) return tab;
  const {
    tabGroupId: _group,
    pinnedUrl: _pinned,
    ...kept
  } = tab as WorkspaceTab & {
    tabGroupId?: unknown;
    pinnedUrl?: unknown;
  };
  return kept;
}

function withoutRetiredBrowsing(
  state: Partial<WorkspaceStore> & RetiredBrowsing,
): Partial<WorkspaceStore> {
  const {
    tabGroups: _groups,
    migratedTabGroupIds: _migrated,
    bookmarkFolders: _folders,
    bookmarks: _bookmarks,
    expandedBookmarkFolders: _expanded,
    selectedBookmarkByFolder: _selected,
    ...kept
  } = state;
  const layout = kept.layout;
  return {
    ...kept,
    ...(layout?.tabs ? { layout: { ...layout, tabs: layout.tabs.map(plainTab) } } : {}),
    ...(Array.isArray(kept.closedItems)
      ? {
          closedItems: kept.closedItems.map((closed) =>
            closed?.tab ? { ...closed, tab: plainTab(closed.tab) } : closed,
          ),
        }
      : {}),
  };
}

const firstProfileScopes = ["space:personal", "global"];
/** What was saved under no scope, or the personal Space's, is the first profile's. Other Spaces'
 * tabs are gone: Spaces own no tabs now. */
const isFirstProfileScope = (scope: string | undefined) =>
  scope === undefined || firstProfileScopes.includes(scope);

/**
 * A window has one layout, and its id comes from the native window. What older shapes saved
 * for the personal Space (or the `global` workspace) becomes it.
 */
function singleLayout(state: Partial<WorkspaceStore> & LegacyLayouts): Partial<WorkspaceStore> {
  const {
    activeScopeKey,
    layoutsByScope,
    windowIdsByScope: _windowIds,
    windowsByScope,
    activeWindowIdByScope,
    closedWindowsByScope: _closed,
    browserProfiles,
    ...kept
  } = state;
  eraseRetiredBrowserProfiles(browserProfiles);
  const scope = firstProfileScopes.find((name) => windowsByScope?.[name]?.length);
  const windows = scope ? windowsByScope?.[scope] : undefined;
  const virtual =
    windows?.find((window) => window.id === activeWindowIdByScope?.[scope!]) ?? windows?.[0];
  const layout =
    (isFirstProfileScope(activeScopeKey) ? state.layout : undefined) ??
    virtual?.layout ??
    layoutsByScope?.["space:personal"] ??
    layoutsByScope?.global;
  return {
    ...kept,
    layout: layout ?? initialWorkspaceLayout(),
    activeWindowId: currentWindowId(),
    dockingLayout: state.dockingLayout ?? virtual?.dockingLayout,
  };
}

export function migrateWorkspaceStore(persisted: unknown, version: number): WorkspaceStore {
  // Every load path (storage, native recovery, account switch) comes through here.
  const upgraded = upgradeWorkspaceShape(persisted) as Partial<WorkspaceStore> | undefined;
  if (!upgraded) return upgraded as unknown as WorkspaceStore;
  const state = withoutRetiredBrowsing(singleLayout(upgraded));
  void version;
  return sanitizeRetiredWorkspaceSurfaces({
    ...state,
    closedItems: migrateClosedWorkspaceItems(state.closedItems),
  }) as WorkspaceStore;
}

function sanitizeRetiredWorkspaceSurfaces(state: Partial<WorkspaceStore>): Partial<WorkspaceStore> {
  const migrateLayout = (layout: WorkspaceLayout) =>
    normalizeWorkspaceLayout(migrateRetiredWorkspaceViews(layout));
  return {
    ...state,
    layout: state.layout ? migrateLayout(state.layout) : state.layout,
    closedItems: migrateClosedWorkspaceItems(state.closedItems).flatMap((closed) => {
      const view = migrateRetiredWorkspaceView(closed.view);
      if (!view) return [];
      const { tab: closedTab, pane: closedPane, ...rest } = closed;
      const tab = closedTab ? migrateRetiredWorkspaceTab(closedTab) : null;
      // A closed tab that held nothing but pages which are gone has nothing to reopen.
      if (closedTab && !tab) return [];
      const pane = closedPane ? migrateRetiredWorkspacePane(closedPane) : undefined;
      return [
        {
          ...rest,
          view,
          ...(pane ? { pane } : {}),
          ...(tab
            ? { tab: layoutTabs(migrateLayout({ ...tab, tabs: [tab], activeTabId: tab.id }))[0] }
            : {}),
        },
      ];
    }),
  };
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
