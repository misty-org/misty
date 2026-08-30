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
  // `/home` is a legacy entry point. The desktop shell resolves it to the
  // active Space's Home so Home never becomes a global app tab.
  if (pathname === routes.home) return null;
  if (pathname.startsWith(routes.inbox))
    return request("inbox", "tool:inbox", "Inbox", pathname, undefined, "multiple");
  if (pathname.startsWith(routes.spaces)) {
    const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
    const rawId = parts[1];
    if (!rawId || !parts[2]) return null;
    const spaceId = safeDecode(rawId);
    const section = parts[2];
    const tool = spaceToolFromSection(section);
    const scopeKey = `space:${spaceId}` as const;
    return {
      ...request(
        "space",
        tool === "space" ? scopeKey : `space:${spaceId}:${tool}`,
        section === "home" ? "Home" : spaceToolTitle(tool),
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
    return request("terminal", "tool:terminal", "Terminal", pathname, undefined, "multiple");
  if (pathname.startsWith(routes.code))
    return request("code", "tool:code", "Code", pathname, undefined, "multiple");
  if (pathname.startsWith(routes.files))
    return request("files", "tool:files", "Files", pathname, undefined, "multiple");
  if (pathname.startsWith(routes.transfers))
    return request("transfers", "tool:transfers", "Transfers", pathname, undefined, "single");
  if (pathname.startsWith(routes.agents))
    return request("agents", "tool:agents", "Agents", pathname, undefined, "multiple");
  if (pathname.startsWith(routes.marketplace))
    return request("marketplace", "tool:marketplace", "Marketplace", pathname, undefined, "single");
  return null;
}

export type SpaceWorkspaceTool = "journal" | "planner" | "social" | "library" | "space";

export function spaceWorkspaceToolFromRoute(pathname: string): SpaceWorkspaceTool {
  return spaceToolFromSection(pathname.split(/[?#]/)[0].split("/").filter(Boolean)[2]);
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
  if (section === "chat" || section === "social") return "social";
  if (section === "planner" || section === "library") return section;
  return "space";
}

function spaceToolTitle(tool: SpaceWorkspaceTool): string {
  if (tool === "journal") return "Journal";
  if (tool === "planner") return "Planner";
  if (tool === "social") return "Social";
  if (tool === "library") return "Library";
  return "Space";
}
