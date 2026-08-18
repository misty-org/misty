import { routes } from "@/features/app-shell";
import {
  browserTabTitle,
  createBrowserTabState,
  defaultBrowserHomeUrl,
  type OpenWorkspaceSurfaceRequest,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "./model";

export function workspaceSurfaceFromRoute(pathname: string): OpenWorkspaceSurfaceRequest | null {
  if (
    pathname === routes.home ||
    pathname === routes.activity ||
    pathname.startsWith(routes.settings)
  )
    return null;
  if (pathname.startsWith(routes.spaces)) {
    const rawId = pathname.split("/").filter(Boolean)[1];
    if (!rawId) return null;
    const spaceId = safeDecode(rawId);
    return request("space", `space:${spaceId}`, "Space", pathname, spaceId, "multiple");
  }
  if (pathname.startsWith(routes.browser)) {
    return {
      ...request("browser", "tool:browser", browserTabTitle(defaultBrowserHomeUrl), pathname),
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

export function shouldReturnWorkspaceHome(
  previousTabCount: number,
  tabCount: number,
  pathname: string,
): boolean {
  return previousTabCount > 0 && tabCount === 0 && pathname !== routes.home;
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
