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
  if (pathname.startsWith(routes.settings)) return null;
  // `/home` is a legacy entry point. The desktop shell resolves it to the
  // active Space's Home so Home never becomes a global app tab.
  if (pathname === routes.home) return null;
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
    const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
    const rawId = parts[1];
    if (!rawId || !parts[2]) return null;
    const spaceId = safeDecode(rawId);
    const section = parts[2];
    const appId = appIdForLegacySpaceSection(section);
    if (appId) {
      const route = legacySpaceAppRoute(pathname, appId, spaceId, parts);
      return {
        ...request("official-app", `app:${appId}`, appTitle(appId), route, appId, "multiple"),
        scopeKey: `space:${spaceId}`,
      };
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

function appIdForLegacySpaceSection(section: string | undefined): string {
  if (section === "notes" || section === "drawings") return "journal";
  if (section === "chat" || section === "social") return "chat";
  if (section === "planner" || section === "library") return section;
  return "";
}

function legacySpaceAppRoute(
  route: string,
  appId: string,
  spaceId: string,
  parts: string[],
): string {
  const source = new URL(route, "https://misty.local");
  const target = new URL(officialAppRoute(appId, spaceId), "https://misty.local");
  source.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  const section = parts[2];
  if (appId === "journal") {
    target.searchParams.set("view", section === "drawings" ? "drawings" : "notes");
    if (section === "drawings" && parts[3]) target.searchParams.set("drawing", parts[3]);
  } else if (appId === "chat" && parts[3]) {
    target.searchParams.set("provider", parts[3]);
  } else if ((appId === "planner" || appId === "library") && parts[3]) {
    target.searchParams.set("view", parts[3]);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

function appTitle(appId: string): string {
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
  if (tool === "social") return "Social";
  if (tool === "library") return "Library";
  return "Space";
}
