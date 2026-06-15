import { mapDockTabs } from "./dockTree";
import { officialAppRoute } from "@/features/apps/appRoute";
import {
  browserTabTitle,
  parseBrowserTabState,
  type WorkspaceLayout,
  type WorkspaceScopeKey,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "./model";
import { workspaceSurfaceFromRoute } from "./routeSurface";

const supportedWorkspaceSurfaces = new Set<WorkspaceSurfaceId>([
  "home",
  "space",
  "official-app",
  "marketplace",
]);

export function isSupportedWorkspaceSurface(value: unknown): value is WorkspaceSurfaceId {
  return typeof value === "string" && supportedWorkspaceSurfaces.has(value as WorkspaceSurfaceId);
}

/**
 * Persisted tabs from older builds can contain surface identifiers this build
 * no longer understands. Convert only unknown surfaces into a safe placeholder;
 * discoverable coming-soon surfaces remain valid tabs.
 */
export function migrateRetiredWorkspaceTabs(
  layout: WorkspaceLayout,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceLayout {
  return {
    ...layout,
    root: mapDockTabs(layout.root, (tab) => migrateRetiredWorkspaceTab(tab, scopeKey)),
  };
}

export function migrateRetiredWorkspaceTab(
  tab: WorkspaceTab,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceTab {
  const groupedAppId = tab.groupKey.startsWith("app:") ? tab.groupKey.slice(4) : "";
  const surfaceAppId = legacySurfaceAppId(tab.surfaceId);
  const officialAppId = officialAppIds.has(groupedAppId)
    ? groupedAppId
    : officialAppIds.has(surfaceAppId)
      ? surfaceAppId
      : "";
  if (officialAppId) {
    const spaceId = scopeKey.startsWith("space:") ? scopeKey.slice(6) : "";
    const existingRequest = workspaceSurfaceFromRoute(tab.route);
    const route =
      existingRequest?.surfaceId === "official-app"
        ? existingRequest.route
        : officialAppRoute(
            officialAppId,
            ["chat", "journal", "planner", "library"].includes(officialAppId) ? spaceId : undefined,
          );
    const request = workspaceSurfaceFromRoute(route);
    if (!request) return tab;
    return {
      ...tab,
      surfaceId: "official-app",
      groupKey: request.groupKey,
      instanceKey: request.instanceKey ?? officialAppId,
      title:
        officialAppId === "chat" && tab.title.trim().toLowerCase() === "chat"
          ? "Social"
          : tab.title.trim() || request.title,
      route,
      sidebarVisible: tab.sidebarVisible,
      state:
        officialAppId === "browser"
          ? parseBrowserTabState(tab.state)
          : (tab.state ?? request.state ?? {}),
    };
  }
  if (isSupportedWorkspaceSurface((tab as { surfaceId?: unknown }).surfaceId)) return tab;
  if (scopeKey.startsWith("space:")) {
    const spaceId = scopeKey.slice(6);
    return {
      ...tab,
      surfaceId: "space",
      groupKey: scopeKey as `space:${string}`,
      instanceKey: spaceId,
      title: "Space",
      route: `/spaces/${encodeURIComponent(spaceId)}/home`,
      sidebarVisible: true,
      state: {},
    };
  }
  return {
    ...tab,
    surfaceId: "home",
    groupKey: "tool:home",
    instanceKey: "home",
    title: "Home",
    route: "/home",
    sidebarVisible: false,
    state: {},
  };
}

function legacySurfaceAppId(surfaceId: WorkspaceSurfaceId): string {
  if (surfaceId === "inbox") return "inbox";
  if (surfaceId === "browser") return "browser";
  if (surfaceId === "terminal") return "terminal";
  if (surfaceId === "code") return "code";
  if (surfaceId === "files") return "files";
  if (surfaceId === "transfers") return "transfers";
  if (surfaceId === "agents") return "agents";
  return "";
}

const officialAppIds = new Set([
  "chat",
  "journal",
  "planner",
  "library",
  "inbox",
  "agents",
  "files",
  "browser",
  "code",
  "terminal",
  "transfers",
]);

export function migrateBrowserTabs(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    ...layout,
    root: mapDockTabs(layout.root, (tab) =>
      tab.surfaceId === "browser"
        ? {
            ...tab,
            title:
              tab.title && tab.title !== "Browser"
                ? tab.title
                : browserTabTitle(parseBrowserTabState(tab.state).url),
            state: parseBrowserTabState(tab.state),
          }
        : tab,
    ),
  };
}

export function migrateSpaceToolTabs(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    ...layout,
    root: mapDockTabs(layout.root, (tab) => {
      if (tab.surfaceId !== "space") return tab;
      const request = workspaceSurfaceFromRoute(tab.route);
      if (!request) return tab;
      if (request.surfaceId === "official-app") {
        return {
          ...tab,
          surfaceId: "official-app",
          groupKey: request.groupKey,
          instanceKey: request.instanceKey ?? tab.instanceKey,
          title: request.title,
          route: request.route,
          sidebarVisible: true,
          state: tab.state ?? request.state ?? {},
        };
      }
      if (request.surfaceId !== "space") return tab;
      return {
        ...tab,
        groupKey: request.groupKey,
        instanceKey: request.instanceKey ?? tab.instanceKey,
        title: request.title,
        route: request.route,
      };
    }),
  };
}
