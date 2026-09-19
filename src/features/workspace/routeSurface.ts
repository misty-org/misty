import { spaceToolRouteFromAppRoute } from "@/features/spaces/spaceAppRoute";
import { canonicalSpaceRoute } from "@/features/spaces/spaceRouteNormalization";
import { routes } from "@/features/app-shell";
import {
  canonicalAppRoute,
  officialAppIdFromSlug,
  officialAppRoute,
} from "@/features/apps/appRoute";
import {
  createBrowserTabState,
  type OpenWorkspaceSurfaceRequest,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "./model";

export function workspaceSurfaceFromRoute(pathname: string): OpenWorkspaceSurfaceRequest | null {
  pathname = canonicalAppRoute(pathname);
  pathname = spaceToolRouteFromAppRoute(pathname) ?? pathname;
  if (pathname.startsWith(routes.settings)) return null;
  if (pathname === routes.home)
    return request("home", "tool:home", "Home", routes.home, "home", "single");
  const legacyGlobalApp = legacyGlobalAppId(pathname);
  if (legacyGlobalApp) {
    const route = officialAppRoute(legacyGlobalApp);
    return {
      ...request(
        "official-app",
        `app:${legacyGlobalApp}`,
        appTitle(legacyGlobalApp),
        route,
        legacyGlobalApp,
        "multiple",
      ),
      ...(legacyGlobalApp === "browser" ? { state: createBrowserTabState() } : {}),
    };
  }
  if (pathname.startsWith(routes.spaces)) {
    pathname = canonicalSpaceRoute(pathname);
    if (!pathname.startsWith(`${routes.spaces}/`))
      return pathname.startsWith(routes.spaces) ? null : workspaceSurfaceFromRoute(pathname);
    const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
    const rawId = parts[1];
    if (!rawId || !parts[2]) return null;
    const spaceId = safeDecode(rawId);
    const section = parts[2];
    if (section === "social" && parts[3] && parts[3] !== "misty") {
      const personal = new URL(pathname, "https://misty.local");
      personal.pathname = "/apps/social";
      personal.searchParams.set("provider", parts[3]);
      personal.searchParams.set("space", spaceId);
      return workspaceSurfaceFromRoute(`${personal.pathname}${personal.search}${personal.hash}`);
    }
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
  if (pathname.startsWith(`${routes.apps}/`)) {
    const appId = appIdFromRoute(pathname);
    if (!appId) return null;
    const spaceId = spaceIdFromAppRoute(pathname);
    return {
      ...request("official-app", `app:${appId}`, appTitle(appId), pathname, appId, "multiple"),
      ...(spaceId ? { scopeKey: `space:${spaceId}` as const } : {}),
    };
  }
  if (pathname.startsWith(routes.discover))
    return request("marketplace", "tool:marketplace", "Discover", pathname, undefined, "single");
  return null;
}

function spaceIdFromAppRoute(route: string): string {
  try {
    return new URL(route, "https://misty.local").searchParams.get("space")?.trim() ?? "";
  } catch {
    return "";
  }
}

function appIdFromRoute(route: string): string {
  try {
    const parsed = new URL(route, "https://misty.local");
    const parts = parsed.pathname.split("/").filter(Boolean);
    const slug = parts[0] === "apps" ? safeDecode(parts[1] ?? "").toLowerCase() : "";
    return officialAppIdFromSlug(slug);
  } catch {
    return "";
  }
}

function legacyGlobalAppId(route: string): string {
  const pathname = route.split(/[?#]/)[0];
  const mappings: Array<[string, string]> = [
    [routes.inbox, "inbox"],
    [routes.browser, "browser"],
    [routes.terminal, "terminal"],
    [routes.code, "code"],
    [routes.files, "files"],
    [routes.agents, "agents"],
  ];
  return (
    mappings.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? ""
  );
}

function appTitle(appId: string): string {
  if (appId === "library") return "Storage";
  if (appId === "chat") return "Social";
  return appId ? `${appId[0]?.toUpperCase()}${appId.slice(1)}` : "App";
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
  if (tool === "social") return "Chat";
  if (tool === "library") return "Library";
  return "Space";
}
