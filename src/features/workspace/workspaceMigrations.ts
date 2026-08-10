import { mapLayoutViews } from "./layoutTabs";
import {
  browserViewTitle,
  createBrowserViewState,
  parseBrowserViewState,
  type WorkspaceLayout,
  type WorkspaceScopeKey,
  type WorkspaceSurfaceId,
  type WorkspaceView,
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
export function migrateRetiredWorkspaceView(
  tab: WorkspaceView,
  _scopeKey: WorkspaceScopeKey = "global",
): WorkspaceView {
  if (tab.surfaceId === "scheduled") {
    const params = new URL(tab.route, "https://misty.local").searchParams;
    params.set("view", "scheduled");
    return {
      ...tab,
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Agents",
      route: `/agents?${params}`,
    };
  }
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
  const state = wasBrowser ? parseBrowserViewState(tab.state) : createBrowserViewState();
  return {
    ...tab,
    surfaceId: "browser",
    groupKey: "tool:browser",
    route: "/browser",
    instanceKey: tab.instanceKey || tab.id,
    state,
    placeholder: tab.placeholder,
    title: wasBrowser && tab.title ? tab.title : browserViewTitle(state.url),
  };
}
export function migrateRetiredWorkspaceViews(
  layout: WorkspaceLayout,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceLayout {
  return mapLayoutViews(layout, (tab) => migrateRetiredWorkspaceView(tab, scopeKey));
}
