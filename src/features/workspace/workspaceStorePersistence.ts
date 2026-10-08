import { initialTabGroups, migrateSavedLinkGroups, savableGroupTabs } from "./tabGroups";
import {
  initialBookmarkNavigation,
  userBookmarkFolders,
} from "@/features/browser-workspace/navigationDefaults";
import { layoutTabs, activateTab } from "./layoutTabs";
import type { WorkspaceDockNode, WorkspaceLayout } from "./model";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { createWorkspaceWindowId, initialWorkspaceLayout, normalizeWorkspaceLayout } from "./windows";
import { migrateRetiredWorkspaceView, migrateRetiredWorkspaceViews } from "./workspaceMigrations";
import { migrateClosedWorkspaceItems } from "./closedWorkspaceItems";
import { upgradeWorkspaceShape } from "./workspaceShapeUpgrade";
import type { WorkspaceScopeKey, WorkspaceWindow } from "./model";
import type { BrowserProfile } from "./browserProfiles";
import type { MistyTabGroup } from "./tabGroups";
import { windowSpaceScope } from "./spaceWindow";
import type { DockingLayout } from "@/features/app-shell/dockingLayout";

/** Saved state from before each Space had its own OS window: virtual windows per scope,
 * and a `global` scope for the default workspace. */
type LegacyWindows = {
  windowsByScope?: Partial<Record<string, WorkspaceWindow[]>>;
  activeWindowIdByScope?: Partial<Record<string, string>>;
  closedWindowsByScope?: unknown;
};

/** The scope this window keeps for what was saved under a legacy scope key. */
function currentScope(scope: string | undefined): WorkspaceScopeKey {
  return scope?.startsWith("profile:") ? (scope as WorkspaceScopeKey) : windowSpaceScope();
}

/**
 * Virtual windows are gone: each Space has one OS window. A scope's active virtual
 * window becomes its layout (its other windows are dropped; there are no users), and the
 * `global` workspace becomes this Space window's own.
 */
function dropVirtualWindows(state: Partial<WorkspaceStore> & LegacyWindows): Partial<WorkspaceStore> {
  const { windowsByScope, activeWindowIdByScope, closedWindowsByScope: _closed, ...rest } = state;
  const savedActive = state.activeScopeKey as string | undefined;
  const layoutsByScope: Partial<Record<WorkspaceScopeKey, WorkspaceLayout>> = {};
  let windowId = state.activeWindowId;
  let dockingLayout: DockingLayout | undefined = state.dockingLayout;
  for (const [scope, layout] of Object.entries(state.layoutsByScope ?? {}))
    if (layout) layoutsByScope[currentScope(scope)] = layout;
  for (const [scope, windows] of Object.entries(windowsByScope ?? {})) {
    if (!windows?.length) continue;
    const active =
      windows.find((window) => window.id === activeWindowIdByScope?.[scope]) ?? windows[0];
    layoutsByScope[currentScope(scope)] = active.layout;
    if (scope === savedActive || (scope === "global" && !savedActive?.startsWith("profile:"))) {
      windowId = active.id;
      dockingLayout ??= active.dockingLayout;
    }
  }
  const activeScopeKey = currentScope(savedActive);
  const layout = state.layout ?? layoutsByScope[activeScopeKey];
  if (layout) layoutsByScope[activeScopeKey] = layout;
  return {
    ...rest,
    activeScopeKey,
    layout: layoutsByScope[activeScopeKey] ?? initialWorkspaceLayout(activeScopeKey),
    layoutsByScope,
    activeWindowId: windowId ?? createWorkspaceWindowId(),
    dockingLayout,
    tabGroups: (state.tabGroups as (MistyTabGroup & { scopeKey: string })[] | undefined)?.map(
      (group) => ({ ...group, scopeKey: currentScope(group.scopeKey) }),
    ),
  };
}

export function migrateWorkspaceStore(persisted: unknown, version: number): WorkspaceStore {
  // Every load path (storage, native recovery, account switch) comes through here.
  const upgraded = upgradeWorkspaceShape(persisted) as Partial<WorkspaceStore> | undefined;
  if (!upgraded) return upgraded as unknown as WorkspaceStore;
  const state = dropVirtualWindows(upgraded);
  const migrated: Partial<WorkspaceStore> = {
    ...state,
    closedItems: migrateClosedWorkspaceItems(state.closedItems),
  };
  void version;

  return {
    ...initialBookmarkNavigation(),
    ...initialTabGroups(),
    ...sanitizeRetiredWorkspaceSurfaces(migrated),
    browserProfiles: validBrowserProfiles(migrated.browserProfiles),
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

/** Stored profiles are kept only when complete; a broken entry is dropped, not repaired. */
function validBrowserProfiles(value: unknown): BrowserProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (profile): profile is BrowserProfile =>
      Boolean(profile) &&
      typeof profile.id === "string" &&
      typeof profile.name === "string" &&
      typeof profile.dataId === "string" &&
      /^[a-f0-9]{64}$/.test(profile.dataId) &&
      typeof profile.createdAt === "number" &&
      (profile.sites === undefined ||
        (Array.isArray(profile.sites) &&
          profile.sites.every((site: unknown) => typeof site === "string"))),
  );
}

function sanitizeRetiredWorkspaceSurfaces(state: Partial<WorkspaceStore>): Partial<WorkspaceStore> {
  const activeScopeKey = state.activeScopeKey ?? windowSpaceScope();
  const migrateLayout = (layout: WorkspaceLayout, scopeKey: WorkspaceScopeKey) => {
    const migrated = normalizeWorkspaceLayout(
      migrateRetiredWorkspaceViews(layout, scopeKey),
      scopeKey,
    );
    const history = (node: WorkspaceDockNode): WorkspaceDockNode => {
      if (node.type === "split")
        return { ...node, first: history(node.first), second: history(node.second) };
      if (!node.history?.entries?.length) return node;
      const entries = node.history.entries.map((view) =>
        migrateRetiredWorkspaceView(view, scopeKey),
      );
      const index = Math.max(
        0,
        Math.min(Number.isFinite(node.history.index) ? node.history.index : 0, entries.length - 1),
      );
      return { ...node, history: { entries, index } };
    };
    const tabs = layoutTabs(migrated).map((tab) => ({ ...tab, root: history(tab.root) }));
    return activateTab({ ...migrated, tabs }, migrated.activeTabId ?? tabs[0].id);
  };
  const layoutsByScope = Object.fromEntries(
    Object.entries(state.layoutsByScope ?? {}).map(([scope, layout]) => [
      scope,
      layout ? migrateLayout(layout, scope as WorkspaceScopeKey) : layout,
    ]),
  ) as WorkspaceStore["layoutsByScope"];

  return {
    ...state,
    activeScopeKey,
    layout: state.layout ? migrateLayout(state.layout, activeScopeKey) : state.layout,
    layoutsByScope,
    closedItems: migrateClosedWorkspaceItems(state.closedItems).map((closed) => ({
      ...closed,
      view: migrateRetiredWorkspaceView(closed.view, activeScopeKey),
      ...(closed.tab
        ? {
            tab: layoutTabs(
              migrateLayout(
                {
                  ...closed.tab,
                  tabs: [closed.tab],
                  activeTabId: closed.tab.id,
                },
                activeScopeKey,
              ),
            )[0],
          }
        : {}),
    })),
  };
}

export function partialWorkspaceStore(state: WorkspaceStore): Partial<WorkspaceStore> {
  // An incognito window never saves; the recovery writer doesn't run there either.
  return {
    tabGroups: state.tabGroups.map((g) => ({
      ...g,
      savedTabs: g.savedTabs ? savableGroupTabs(g.savedTabs) : undefined,
    })),
    migratedTabGroupIds: state.migratedTabGroupIds,
    browserProfiles: state.browserProfiles,
    bookmarkFolders: state.bookmarkFolders,
    bookmarks: state.bookmarks,
    expandedBookmarkFolders: state.expandedBookmarkFolders,
    selectedBookmarkByFolder: state.selectedBookmarkByFolder,
    activeScopeKey: state.activeScopeKey,
    layout: state.layout,
    layoutsByScope: { ...state.layoutsByScope, [state.activeScopeKey]: state.layout },
    activeWindowId: state.activeWindowId,
    dockingLayout: state.dockingLayout,
    lastUsedViewByGroup: state.lastUsedViewByGroup,
    closedItems: state.closedItems,
  };
}
