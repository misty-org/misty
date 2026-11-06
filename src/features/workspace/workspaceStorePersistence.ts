import { initialTabGroups, migrateSavedLinkGroups, savableGroupTabs } from "./tabGroups";
import {
  initialBookmarkNavigation,
  userBookmarkFolders,
} from "@/features/bookmarks/navigationDefaults";
import { layoutTabs, activateTab } from "./layoutTabs";
import { rendererRecords } from "./profileRecordModel";
import type { WorkspaceDockNode, WorkspaceLayout, WorkspaceWindow } from "./model";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { initialWorkspaceLayout, normalizeWorkspaceLayout } from "./windows";
import { migrateRetiredWorkspaceView, migrateRetiredWorkspaceViews } from "./workspaceMigrations";
import { migrateClosedWorkspaceItems } from "./closedWorkspaceItems";
import { upgradeWorkspaceShape } from "./workspaceShapeUpgrade";
import { currentWindowId } from "./profileWindow";
import { eraseRetiredBrowserProfiles } from "./retiredBrowserProfiles";
import { nativeWorkspaceRecoveryEnabled } from "./workspaceRecoveryPlatform";

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
    tabGroups: (state.tabGroups as (WorkspaceStore["tabGroups"][number] & { scopeKey?: string })[])
      ?.filter((group) => isFirstProfileScope(group.scopeKey))
      .map(({ scopeKey: _scope, ...group }) => group),
  };
}

export function migrateWorkspaceStore(persisted: unknown, version: number): WorkspaceStore {
  // Every load path (storage, native recovery, account switch) comes through here.
  const upgraded = upgradeWorkspaceShape(persisted) as Partial<WorkspaceStore> | undefined;
  if (!upgraded) return upgraded as unknown as WorkspaceStore;
  const state = singleLayout(upgraded);
  const migrated: Partial<WorkspaceStore> = {
    ...state,
    closedItems: migrateClosedWorkspaceItems(state.closedItems),
    bookmarkFolders: rendererRecords(
      state.bookmarkFolders ?? [],
    ) as WorkspaceStore["bookmarkFolders"],
    bookmarks: rendererRecords(state.bookmarks ?? []) as WorkspaceStore["bookmarks"],
  };
  void version;

  return {
    ...initialBookmarkNavigation(),
    ...initialTabGroups(),
    ...sanitizeRetiredWorkspaceSurfaces(migrated),
    ...migrateSavedLinkGroups({
      ...migrated,
      bookmarkFolders: userBookmarkFolders(
        migrated.bookmarkFolders ?? [],
        migrated.bookmarks ?? [],
      ),
      bookmarks: migrated.bookmarks ?? [],
    }),
    bookmarkFolders: userBookmarkFolders(migrated.bookmarkFolders ?? [], migrated.bookmarks ?? []),
  } as WorkspaceStore;
}

function sanitizeRetiredWorkspaceSurfaces(state: Partial<WorkspaceStore>): Partial<WorkspaceStore> {
  const migrateLayout = (layout: WorkspaceLayout) => {
    const migrated = normalizeWorkspaceLayout(migrateRetiredWorkspaceViews(layout));
    const history = (node: WorkspaceDockNode): WorkspaceDockNode => {
      if (node.type === "split")
        return { ...node, first: history(node.first), second: history(node.second) };
      if (!node.history?.entries?.length) return node;
      const entries = node.history.entries.map((view) => migrateRetiredWorkspaceView(view));
      const index = Math.max(
        0,
        Math.min(Number.isFinite(node.history.index) ? node.history.index : 0, entries.length - 1),
      );
      return { ...node, history: { entries, index } };
    };
    const tabs = layoutTabs(migrated).map((tab) => ({ ...tab, root: history(tab.root) }));
    return activateTab({ ...migrated, tabs }, migrated.activeTabId ?? tabs[0].id);
  };

  return {
    ...state,
    layout: state.layout ? migrateLayout(state.layout) : state.layout,
    closedItems: migrateClosedWorkspaceItems(state.closedItems).map((closed) => ({
      ...closed,
      view: migrateRetiredWorkspaceView(closed.view),
      ...(closed.tab
        ? {
            tab: layoutTabs(
              migrateLayout({
                ...closed.tab,
                tabs: [closed.tab],
                activeTabId: closed.tab.id,
              }),
            )[0],
          }
        : {}),
    })),
  };
}

/** What a window saves. Its bookmarks and saved tab groups are the profile's records
 * (profileRecords.ts), shared by all its windows; only a browser with no native side keeps
 * them here. An incognito window never saves; the recovery writer doesn't run there either. */
export function partialWorkspaceStore(state: WorkspaceStore): Partial<WorkspaceStore> {
  const native = nativeWorkspaceRecoveryEnabled();
  return {
    tabGroups: (native ? state.tabGroups.filter((group) => !group.savedTabs) : state.tabGroups).map(
      (group) => ({
        ...group,
        savedTabs: group.savedTabs ? savableGroupTabs(group.savedTabs) : undefined,
      }),
    ),
    migratedTabGroupIds: state.migratedTabGroupIds,
    ...(native ? {} : { bookmarkFolders: state.bookmarkFolders, bookmarks: state.bookmarks }),
    expandedBookmarkFolders: state.expandedBookmarkFolders,
    selectedBookmarkByFolder: state.selectedBookmarkByFolder,
    layout: state.layout,
    activeWindowId: state.activeWindowId,
    dockingLayout: state.dockingLayout,
    lastUsedViewByGroup: state.lastUsedViewByGroup,
    closedItems: state.closedItems,
  };
}
