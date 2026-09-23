import { mapLayoutViews } from "./layoutTabs";
import {
  browserTabTitle,
  createBrowserTabState,
  parseBrowserTabState,
  type WorkspaceLayout,
  type WorkspaceScopeKey,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "./model";

export function isSupportedWorkspaceSurface(value: unknown): value is WorkspaceSurfaceId {
  return value === "browser" || value === "agents" || value === "files" || value === "space";
}
export function migrateRetiredWorkspaceTab(
  tab: WorkspaceTab,
  _scopeKey: WorkspaceScopeKey = "global",
): WorkspaceTab {
  if (tab.surfaceId === "space" && /^\/spaces(?:\/|$)/.test(tab.route)) return tab;
  if (tab.surfaceId === "files" || tab.groupKey === "app:files") {
    const search = new URL(tab.route, "https://misty.local").search;
    return {
      ...tab,
      surfaceId: "files",
      groupKey: "tool:files",
      route: `/files${search}`,
      placeholder: false,
    };
  }
  const agents = tab.surfaceId === "agents" || tab.groupKey === "app:agents";
  if (agents)
    return {
      ...tab,
      surfaceId: "agents",
      groupKey: "tool:agents",
      route: `/agents${new URL(tab.route, "https://misty.local").search}`,
      placeholder: false,
    };
  const wasBrowser = tab.surfaceId === "browser" || tab.groupKey === "app:browser";
  const state = wasBrowser ? parseBrowserTabState(tab.state) : createBrowserTabState();
  return {
    ...tab,
    surfaceId: "browser",
    groupKey: "tool:browser",
    route: "/browser",
    instanceKey: tab.instanceKey || tab.id,
    state,
    placeholder: false,
    title: wasBrowser && tab.title ? tab.title : browserTabTitle(state.url),
  };
}
export function migrateRetiredWorkspaceTabs(
  layout: WorkspaceLayout,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceLayout {
  return mapLayoutViews(layout, (tab) => migrateRetiredWorkspaceTab(tab, scopeKey));
}
