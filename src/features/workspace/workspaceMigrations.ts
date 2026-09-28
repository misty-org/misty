import { workspaceSurfaceFromRoute } from "./routeSurface";
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
  return (
    value === "home" ||
    value === "browser" ||
    value === "agents" ||
    value === "scheduled" ||
    value === "files" ||
    value === "space"
  );
}
export function migrateRetiredWorkspaceTab(
  tab: WorkspaceTab,
  _scopeKey: WorkspaceScopeKey = "global",
): WorkspaceTab {
  const destination = workspaceSurfaceFromRoute(tab.route);
  if (tab.surfaceId === "scheduled" || destination?.surfaceId === "scheduled")
    return {
      ...tab,
      surfaceId: "scheduled",
      groupKey: "tool:scheduled",
      title: tab.surfaceId === "scheduled" ? tab.title : "Scheduled",
      route: destination?.route ?? "/scheduled",
    };
  if (tab.surfaceId === "home" && tab.route === "/home") return tab;
  if (tab.surfaceId === "space" && /^\/spaces(?:\/|$)/.test(tab.route)) return tab;
  const retiredTransfers =
    (tab.surfaceId as string) === "transfers" || (tab.groupKey as string) === "tool:transfers";
  if (tab.surfaceId === "files" || tab.groupKey === "app:files" || retiredTransfers) {
    const url = new URL(tab.route, "https://misty.local");
    if (url.searchParams.get("view") === "transfers") url.searchParams.delete("view");
    const search = url.search;
    return {
      ...tab,
      surfaceId: "files",
      title: retiredTransfers || tab.title === "Transfers" ? "Files" : tab.title,
      groupKey: "tool:files",
      route: `/files${search}`,
      placeholder: tab.placeholder,
    };
  }
  const agents = tab.surfaceId === "agents" || tab.groupKey === "app:agents";
  if (agents)
    return {
      ...tab,
      surfaceId: "agents",
      groupKey: "tool:agents",
      route: `/agents${new URL(tab.route, "https://misty.local").search}`,
      placeholder: tab.placeholder,
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
    placeholder: tab.placeholder,
    title: wasBrowser && tab.title ? tab.title : browserTabTitle(state.url),
  };
}
export function migrateRetiredWorkspaceTabs(
  layout: WorkspaceLayout,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceLayout {
  return mapLayoutViews(layout, (tab) => migrateRetiredWorkspaceTab(tab, scopeKey));
}
