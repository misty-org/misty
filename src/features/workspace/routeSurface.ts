import {
  createBrowserViewState,
  type OpenWorkspaceSurfaceRequest,
  type WorkspaceSurfaceId,
} from "./model";

export function workspaceSurfaceFromRoute(pathname: string): OpenWorkspaceSurfaceRequest | null {
  const path = pathname.split(/[?#]/)[0];
  if (
    path.startsWith("/settings") ||
    path.startsWith("/account") ||
    path === "/signin" ||
    path === "/register"
  )
    return null;
  const url = new URL(pathname, "https://misty.local");
  if (path === "/extensions" || path.startsWith("/extensions/")) {
    return {
      ...request("extensions", "tool:extensions", "Extensions", pathname, "extensions", "single"),
      scopeKey: "global",
    };
  }
  if (path === "/scheduled") {
    url.searchParams.set("view", "scheduled");
    return {
      ...request(
        "agents",
        "tool:agents",
        "Agents",
        `/agents${url.search}${url.hash}`,
        "agents",
        "single",
      ),
      scopeKey: "global",
    };
  }
  if (path === "/spaces" || path.startsWith("/spaces/")) {
    const parts = path.split("/").filter(Boolean);
    let spaceId = "";
    try {
      spaceId = decodeURIComponent(parts[1] ?? "");
    } catch {
      return null;
    }
    const tool = spaceToolFromSection(parts[2]);
    return {
      ...request(
        "space",
        spaceId ? `space:${spaceId}:${tool}` : "tool:space",
        tool === "social"
          ? "Chat"
          : tool === "journal"
            ? "Journal"
            : tool === "planner"
              ? "Planner"
              : tool === "library"
                ? "Library"
                : "Spaces",
        pathname,
        spaceId ? `${spaceId}:${tool}` : "spaces",
        "single",
      ),
      scopeKey: "global",
    };
  }
  if (path === "/agents" || path === "/apps/agents")
    return {
      ...request(
        "agents",
        "tool:agents",
        "Agents",
        `/agents${new URL(pathname, "https://misty.local").search}`,
        "agents",
        "single",
      ),
      scopeKey: "global",
    };
  if (
    ["/", "/new", "/browser", "/apps/browser"].includes(path) ||
    path.startsWith("/apps") ||
    path === "/discover"
  ) {
    const url = new URL(pathname, "https://misty.local").searchParams.get("url");
    return {
      ...request("browser", "tool:browser", "Browser", "/browser", undefined, "multiple"),
      scopeKey: "global",
      state: createBrowserViewState(url ?? undefined),
    };
  }
  return null;
}

export type SpaceWorkspaceTool = "journal" | "planner" | "social" | "library" | "space";

export function spaceWorkspaceToolFromRoute(pathname: string): SpaceWorkspaceTool {
  return spaceToolFromSection(pathname.split(/[?#]/)[0].split("/").filter(Boolean)[2]);
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

function spaceToolFromSection(section: string | undefined): SpaceWorkspaceTool {
  if (section === "notes" || section === "drawings") return "journal";
  if (section === "chat" || section === "social") return "social";
  if (section === "planner" || section === "library") return section;
  return "space";
}
