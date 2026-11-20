import type { OpenWorkspaceSurfaceRequest, WorkspaceSurfaceId } from "./workspaceViews";
import { officialApps } from "@misty/ui";

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
    // Apps run in their own page inside a Space. Keep each app's route distinct from the Space
    // home and from other apps, or navigation can focus an unrelated earlier Space tab.
    if (parts[2] === "app") {
      let appId = "";
      try {
        appId = decodeURIComponent(parts[3] ?? "");
      } catch {
        return null;
      }
      if (!spaceId || !appId) return null;
      const app = officialApps.find((candidate) => candidate.id === appId);
      return request(
        "space",
        `app:${spaceId}:${appId}`,
        app?.name ?? appId,
        pathname,
        `${spaceId}:${appId}`,
      );
    }
    const tool = spaceToolFromSection(parts[2]);
    return request(
      "space",
      spaceId ? `space:${spaceId}:${tool}` : "tool:space",
      tool === "space" && !spaceId ? "Spaces" : spaceToolTitles[tool],
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

type SpaceWorkspaceTool =
  | "explore"
  | "journal"
  | "slides"
  | "data"
  | "whiteboards"
  | "social"
  | "planner"
  | "calendar"
  | "media"
  | "lab"
  | "space";

/** A Space tab's name, by the tool it shows. */
const spaceToolTitles: Record<SpaceWorkspaceTool, string> = {
  explore: "Explore",
  journal: "Docs",
  slides: "Slides",
  data: "Data",
  whiteboards: "Whiteboards",
  social: "Chat",
  planner: "Planner",
  calendar: "Calendar",
  media: "Media",
  lab: "Lab",
  space: "Space",
};

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
  if (section === "explore" || section === "agents") return "explore";
  // Docs, Slides, Data and Whiteboards are pages of their own, each in its own tab.
  if (section === "notes") return "journal";
  if (section === "slides" || section === "data") return section;
  if (section === "drawings") return "whiteboards";
  if (section === "chat" || section === "social") return "social";
  // The Library became Media; a tab saved under the old name opens Media.
  if (section === "media" || section === "library" || section === "files") return "media";
  if (section === "planner" || section === "calendar" || section === "lab") return section;
  return "space";
}
