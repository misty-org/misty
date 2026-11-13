import type { OpenWorkspaceSurfaceRequest, WorkspaceSurfaceId } from "./workspaceViews";

/** A route that once opened a web page for the person. Web pages are only for agents now, so it
 * opens nothing. */
export function isRetiredWebRoute(pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0];
  return (
    ["/", "/new", "/browser", "/discover"].includes(path) ||
    (path.startsWith("/apps") && path !== "/apps/agents")
  );
}

export function workspaceSurfaceFromRoute(pathname: string): OpenWorkspaceSurfaceRequest | null {
  const path = pathname.split(/[?#]/)[0];
  if (
    path.startsWith("/settings") ||
    path.startsWith("/account") ||
    path === "/welcome" ||
    path === "/signin" ||
    path === "/register"
  )
    return null;
  // Scheduled work is gone; its old link opens Agents.
  if (path === "/scheduled")
    return request("agents", "tool:agents", "Agents", "/agents", "agents", "single");
  if (path === "/spaces" || path.startsWith("/spaces/")) {
    const parts = path.split("/").filter(Boolean);
    let spaceId = "";
    try {
      spaceId = decodeURIComponent(parts[1] ?? "");
    } catch {
      return null;
    }
    const tool = spaceToolFromSection(parts[2]);
    return request(
      "space",
      spaceId ? `space:${spaceId}:${tool}` : "tool:space",
      tool === "social"
        ? "Chat"
        : tool === "journal"
          ? "Docs"
          : tool === "planner"
            ? "Planner"
            : tool === "calendar"
              ? "Calendar"
              : tool === "library"
                ? "Library"
                : spaceId
                  ? "Home"
                  : "Spaces",
      pathname,
      spaceId ? `${spaceId}:${tool}` : "spaces",
      "single",
    );
  }
  if (path === "/agents" || path === "/apps/agents")
    return request(
      "agents",
      "tool:agents",
      "Agents",
      `/agents${new URL(pathname, "https://misty.local").search}`,
      "agents",
      "single",
    );
  return null;
}

type SpaceWorkspaceTool = "journal" | "social" | "planner" | "calendar" | "library" | "space";

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

/** Which of a Space's tabs a section opens in. Home is the bare Space (its gallery); it never
 * shares Chat's tab, or opening one would swap the other's page under the wrong name. */
function spaceToolFromSection(section: string | undefined): SpaceWorkspaceTool {
  if (section === "notes" || section === "drawings") return "journal";
  if (section === "chat" || section === "social") return "social";
  if (section === "planner" || section === "calendar" || section === "library") return section;
  return "space";
}
