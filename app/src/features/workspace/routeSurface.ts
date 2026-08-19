import { routes } from "@/features/app-shell";
import {
  browserTabTitle,
  createBrowserTabState,
  browserHomeUrl,
  type OpenWorkspaceSurfaceRequest,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "./model";

export function workspaceSurfaceFromRoute(pathname: string): OpenWorkspaceSurfaceRequest | null {
  if (pathname.startsWith(routes.settings)) return null;
  // Home is an ordinary, stackable tab. It is also what a pane falls back to
  // when its last tab closes, so it must resolve to a surface like any other.
  if (pathname === routes.home) return request("home", "tool:home", "Home", pathname);
  if (pathname.startsWith(routes.spaces)) {
    const parts = pathname.split("/").filter(Boolean);
    const rawId = parts[1];
    if (!rawId) return null;
    const spaceId = safeDecode(rawId);
    const tool = spaceToolFromSection(parts[2]);
    const scopeKey = `space:${spaceId}` as const;
    return {
      ...request(
        "space",
        tool === "space" ? scopeKey : `space:${spaceId}:${tool}`,
        spaceToolTitle(tool),
        pathname,
        tool === "space" ? spaceId : `${spaceId}:${tool}`,
        "multiple",
      ),
      scopeKey,
    };
  }
  if (pathname.startsWith(routes.browser)) {
    return {
      ...request("browser", "tool:browser", browserTabTitle(browserHomeUrl()), pathname),
      state: createBrowserTabState(),
    };
  }
  if (pathname.startsWith(routes.terminal))
    return request("terminal", "tool:terminal", "Terminal", pathname, undefined, "single");
  if (pathname.startsWith(routes.code))
    return request("code", "tool:code", "Code", pathname, undefined, "single");
  if (pathname.startsWith(routes.files))
    return request("files", "tool:files", "Files", pathname, undefined, "single");
  if (pathname.startsWith(routes.transfers))
    return request("transfers", "tool:transfers", "Transfers", pathname, undefined, "single");
  if (pathname.startsWith(routes.agents))
    return request("agents", "tool:agents", "Agents", pathname, undefined, "single");
  if (pathname.startsWith(routes.extensions))
    return request("extensions", "tool:extensions", "Extensions", pathname, undefined, "single");
  return null;
}

export type SpaceWorkspaceTool = "journal" | "planner" | "chat" | "library" | "space";

export function spaceWorkspaceToolFromRoute(pathname: string): SpaceWorkspaceTool {
  return spaceToolFromSection(pathname.split("/").filter(Boolean)[2]);
}

/** Whether a tab owns the route even when a nested route or redirect changed its exact URL. */
export function workspaceTabMatchesRoute(
  tab: Pick<WorkspaceTab, "surfaceId" | "groupKey">,
  pathname: string,
): boolean {
  const surface = workspaceSurfaceFromRoute(pathname);
  return Boolean(
    surface && surface.surfaceId === tab.surfaceId && surface.groupKey === tab.groupKey,
  );
}

function request(
  surfaceId: WorkspaceSurfaceId,
  groupKey: OpenWorkspaceSurfaceRequest["groupKey"],
  title: string,
  route: string,
  instanceKey?: string,
  instancePolicy: OpenWorkspaceSurfaceRequest["instancePolicy"] = "multiple",
): OpenWorkspaceSurfaceRequest {
  return {
    surfaceId,
    groupKey,
    title,
    route,
    instanceKey,
    instancePolicy,
    syncExistingRoute: true,
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function spaceToolFromSection(section: string | undefined): SpaceWorkspaceTool {
  if (section === "notes" || section === "drawings") return "journal";
  if (section === "planner" || section === "chat" || section === "library") return section;
  return "space";
}

function spaceToolTitle(tool: SpaceWorkspaceTool): string {
  if (tool === "journal") return "Journal";
  if (tool === "planner") return "Planner";
  if (tool === "chat") return "Chat";
  if (tool === "library") return "Library";
  return "Space";
}
