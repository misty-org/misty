import { describe, expect, it } from "vitest";
import { workspaceSurfaceFromRoute, workspaceTabMatchesRoute } from "./routeSurface";

describe("workspace deep links", () => {
  it("keeps Home outside the desktop workspace", () => {
    expect(workspaceSurfaceFromRoute("/home")).toBeNull();
  });

  it("groups Space deep links by decoded Space id", () => {
    expect(workspaceSurfaceFromRoute("/spaces/product%20launch/planner")).toMatchObject({
      surfaceId: "space",
      groupKey: "space:product launch",
      route: "/spaces/product%20launch/planner",
    });
  });

  it("keeps nested routes in the same Space workspace", () => {
    const tab = {
      surfaceId: "space" as const,
      groupKey: "space:product launch" as const,
    };

    expect(workspaceTabMatchesRoute(tab, "/spaces/product%20launch/notes")).toBe(true);
    expect(workspaceTabMatchesRoute(tab, "/spaces/another-space/notes")).toBe(false);
  });

  it.each([
    ["/browser", "browser"],
    ["/terminal", "terminal"],
    ["/code", "code"],
    ["/files", "files"],
    ["/agents", "agents"],
    ["/extensions", "extensions"],
  ])("maps %s to the %s surface", (route, surfaceId) => {
    expect(workspaceSurfaceFromRoute(route)?.surfaceId).toBe(surfaceId);
  });
});
