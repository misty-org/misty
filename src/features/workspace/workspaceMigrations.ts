import { mapDockTabs } from "./dockTree";
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
  "inbox",
  "space",
  "browser",
  "terminal",
  "code",
  "files",
  "transfers",
  "agents",
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
    root: mapDockTabs(layout.root, (tab) =>
      isSupportedWorkspaceSurface((tab as { surfaceId?: unknown }).surfaceId)
        ? tab
        : migrateRetiredWorkspaceTab(tab, scopeKey),
    ),
  };
}

export function migrateRetiredWorkspaceTab(
  tab: WorkspaceTab,
  scopeKey: WorkspaceScopeKey = "global",
): WorkspaceTab {
  if (isSupportedWorkspaceSurface((tab as { surfaceId?: unknown }).surfaceId)) return tab;
  if (scopeKey.startsWith("space:")) {
    const spaceId = scopeKey.slice(6);
    return {
      ...tab,
      surfaceId: "space",
      groupKey: scopeKey as `space:${string}`,
      instanceKey: spaceId,
      title: "Space",
      route: `/spaces/${encodeURIComponent(spaceId)}/notes`,
      sidebarVisible: true,
      state: {},
    };
  }
  return {
    ...tab,
    surfaceId: "inbox",
    groupKey: "tool:inbox",
    instanceKey: "inbox",
    title: "Inbox",
    route: "/inbox",
    sidebarVisible: false,
    state: {},
  };
}

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
      if (!request || request.surfaceId !== "space") return tab;
      return {
        ...tab,
        groupKey: request.groupKey,
        instanceKey: request.instanceKey ?? tab.instanceKey,
        title: request.title,
        route: canonicalSocialRoute(tab.route),
      };
    }),
  };
}

function canonicalSocialRoute(route: string): string {
  try {
    const parsed = new URL(route, "https://misty.local");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "spaces" || (parts[2] !== "chat" && parts[2] !== "social")) return route;
    const requestedProvider = parts[3] ?? parsed.searchParams.get("provider") ?? "misty";
    const provider =
      requestedProvider === "instagram" ||
      requestedProvider === "discord" ||
      requestedProvider === "messenger" ||
      requestedProvider === "x"
        ? requestedProvider
        : "misty";
    parsed.pathname = `/spaces/${parts[1]}/social/${provider}`;
    parsed.searchParams.delete("provider");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return route;
  }
}
