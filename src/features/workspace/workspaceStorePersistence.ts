import { initialTabGroups, migrateSavedLinkGroups, savableGroupTabs } from "./tabGroups";
import {
  initialBookmarkNavigation,
  userBookmarkFolders,
} from "@/features/browser-workspace/navigationDefaults";
import { layoutTabs, mapLayoutViews, activateTab } from "./layoutTabs";
import type { WorkspaceDockNode, WorkspaceLayout } from "./model";
import type { WorkspaceStore } from "./useWorkspaceStore";
import {
  createWorkspaceWindow,
  initialWorkspaceLayout,
  mapAllWorkspaceWindowViews,
  normalizeWorkspaceLayout,
} from "./windows";
import { isPrivateBrowserView, scrubPrivateView } from "./privateBrowsing";
import { migrateRetiredWorkspaceView, migrateRetiredWorkspaceViews } from "./workspaceMigrations";
import { migrateClosedWorkspaceItems } from "./closedWorkspaceItems";
import { upgradeWorkspaceShape } from "./workspaceShapeUpgrade";
import type { WorkspaceScopeKey, WorkspaceWindow } from "./model";
import type { BrowserProfile } from "./browserProfiles";

export function migrateWorkspaceStore(persisted: unknown, version: number): WorkspaceStore {
  // Every load path (storage, native recovery, account switch) comes through here.
  const state = upgradeWorkspaceShape(persisted) as Partial<WorkspaceStore> | undefined;
  if (!state) return state as unknown as WorkspaceStore;

  let migrated: Partial<WorkspaceStore> = state;
  if (version >= 6) {
    migrated = state;
  } else if (version >= 5) {
    migrated = { ...state, closedItems: migrateClosedWorkspaceItems(state.closedItems) };
  } else if (version >= 4) {
    migrated = {
      ...state,
      closedItems: migrateClosedWorkspaceItems(state.closedItems),
      closedWindowsByScope: {},
    };
  } else {
    const layoutsByScope = Object.fromEntries(
      Object.entries(state.layoutsByScope ?? {}).map(([scope, layout]) => [
        scope,
        layout
          ? normalizeWorkspaceLayout(
              migrateRetiredWorkspaceViews(layout),
              scope as WorkspaceScopeKey,
            )
          : layout,
      ]),
    ) as WorkspaceStore["layoutsByScope"];
    const activeScopeKey = state.activeScopeKey ?? "global";
    const activeLayout = normalizeWorkspaceLayout(
      migrateRetiredWorkspaceViews(
        state.layout ?? layoutsByScope[activeScopeKey] ?? initialWorkspaceLayout(),
      ),
      activeScopeKey,
    );
    layoutsByScope[activeScopeKey] = activeLayout;
    const virtualWindowsByScope = Object.fromEntries(
      Object.entries(layoutsByScope).flatMap(([scope, layout]) =>
        layout
          ? [[scope, [createWorkspaceWindow(layout, undefined, scope as WorkspaceScopeKey)]]]
          : [],
      ),
    ) as WorkspaceStore["windowsByScope"];
    const activeVirtualWindowIdByScope = Object.fromEntries(
      Object.entries(virtualWindowsByScope).map(([scope, windows]) => [scope, windows?.[0]?.id]),
    ) as WorkspaceStore["activeWindowIdByScope"];
    migrated = {
      ...state,
      activeScopeKey,
      layout: activeLayout,
      layoutsByScope,
      windowsByScope: virtualWindowsByScope,
      activeWindowIdByScope: activeVirtualWindowIdByScope,
      activeWindowId: activeVirtualWindowIdByScope[activeScopeKey]!,
      closedItems: migrateClosedWorkspaceItems(state.closedItems),
      closedWindowsByScope: {},
    };
  }

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
  const activeScopeKey = state.activeScopeKey ?? "global";
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
  const migrateWindows = (windows: WorkspaceWindow[] | undefined, scopeKey: WorkspaceScopeKey) =>
    windows?.map((window) => ({ ...window, layout: migrateLayout(window.layout, scopeKey) }));

  const layoutsByScope = Object.fromEntries(
    Object.entries(state.layoutsByScope ?? {}).map(([scope, layout]) => [
      scope,
      layout ? migrateLayout(layout, scope as WorkspaceScopeKey) : layout,
    ]),
  ) as WorkspaceStore["layoutsByScope"];
  const virtualWindowsByScope = Object.fromEntries(
    Object.entries(state.windowsByScope ?? {}).map(([scope, windows]) => [
      scope,
      migrateWindows(windows, scope as WorkspaceScopeKey),
    ]),
  ) as WorkspaceStore["windowsByScope"];
  const closedVirtualWindowsByScope = Object.fromEntries(
    Object.entries(state.closedWindowsByScope ?? {}).map(([scope, windows]) => [
      scope,
      migrateWindows(windows, scope as WorkspaceScopeKey),
    ]),
  ) as WorkspaceStore["closedWindowsByScope"];

  return {
    ...state,
    activeScopeKey,
    layout: state.layout ? migrateLayout(state.layout, activeScopeKey) : state.layout,
    layoutsByScope,
    windowsByScope: virtualWindowsByScope,
    closedWindowsByScope: closedVirtualWindowsByScope,
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
  // Private tabs are never written anywhere with their pages or titles.
  const scrubbed = mapAllWorkspaceWindowViews(state, scrubPrivateView);
  const closedVirtualWindowsByScope = Object.fromEntries(
    Object.entries(state.closedWindowsByScope).map(([scope, windows]) => [
      scope,
      windows?.map((window) => ({
        ...window,
        layout: mapLayoutViews(window.layout, scrubPrivateView),
      })),
    ]),
  ) as WorkspaceStore["closedWindowsByScope"];
  state = { ...state, ...scrubbed, closedWindowsByScope: closedVirtualWindowsByScope };
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
    windowsByScope: state.windowsByScope,
    activeWindowIdByScope: state.activeWindowIdByScope,
    activeWindowId: state.activeWindowId,
    lastUsedViewByGroup: state.lastUsedViewByGroup,
    closedItems: state.closedItems.filter((closed) => !isPrivateBrowserView(closed.view)),
    closedWindowsByScope: state.closedWindowsByScope,
  };
}
