import { describe, expect, it } from "vitest";
import { workspaceSurfaceFromRoute, workspaceTabMatchesRoute } from "./routeSurface";

describe("workspace deep links", () => {
  it("keeps Settings outside the desktop workspace", () => {
    expect(workspaceSurfaceFromRoute("/settings")).toBeNull();
  });

  it("keeps legacy global Home outside the app workspace", () => {
    expect(workspaceSurfaceFromRoute("/home")).toBeNull();
  });

  it("opens Home inside its Space scope", () => {
    expect(workspaceSurfaceFromRoute("/spaces/family/home")).toMatchObject({
      surfaceId: "space",
      groupKey: "space:family",
      scopeKey: "space:family",
      title: "Home",
    });
  });

  it("gives each Space tool its own tab identity within the decoded Space scope", () => {
    expect(workspaceSurfaceFromRoute("/spaces/product%20launch/planner")).toMatchObject({
      surfaceId: "space",
      groupKey: "space:product launch:planner",
      scopeKey: "space:product launch",
      title: "Planner",
      route: "/spaces/product%20launch/planner",
    });
  });

  it("keeps Social separate and maps legacy Chat routes into its group", () => {
    expect(workspaceSurfaceFromRoute("/spaces/family/social")).toMatchObject({
      groupKey: "space:family:social",
      title: "Social",
    });
    expect(workspaceSurfaceFromRoute("/spaces/family/chat")).toMatchObject({
      groupKey: "space:family:social",
      title: "Social",
    });
  });

  it("preserves the selected Social provider in the workspace tab route", () => {
    const route = "/spaces/family/social/messenger";

    expect(workspaceSurfaceFromRoute(route)).toMatchObject({
      groupKey: "space:family:social",
      route,
    });
  });

  it("matches nested routes only within the same Space tool tab", () => {
    const tab = {
      surfaceId: "space" as const,
      groupKey: "space:product launch:journal" as const,
    };

    expect(workspaceTabMatchesRoute(tab, "/spaces/product%20launch/notes")).toBe(true);
    expect(workspaceTabMatchesRoute(tab, "/spaces/product%20launch/drawings/one")).toBe(true);
    expect(workspaceTabMatchesRoute(tab, "/spaces/product%20launch/planner")).toBe(false);
    expect(workspaceTabMatchesRoute(tab, "/spaces/another-space/notes")).toBe(false);
  });

  it.each([
    ["/browser", "browser"],
    ["/inbox", "inbox"],
    ["/terminal", "terminal"],
    ["/code", "code"],
    ["/files", "files"],
    ["/agents", "agents"],
    ["/transfers", "transfers"],
    ["/store", "marketplace"],
  ])("maps %s to the %s surface", (route, surfaceId) => {
    expect(workspaceSurfaceFromRoute(route)?.surfaceId).toBe(surfaceId);
  });

  it("opens coming-soon launch surfaces as singleton tabs", () => {
    for (const route of ["/store", "/transfers"]) {
      expect(workspaceSurfaceFromRoute(route)?.instancePolicy).toBe("single");
    }
  });

  it("keeps legacy catalog links compatible with the Store surface", () => {
    expect(workspaceSurfaceFromRoute("/marketplace")).toMatchObject({
      surfaceId: "marketplace",
      groupKey: "tool:marketplace",
      instancePolicy: "single",
    });
  });

  it("opens Inbox as one account-level tool surface", () => {
    expect(workspaceSurfaceFromRoute("/inbox")).toMatchObject({
      surfaceId: "inbox",
      groupKey: "tool:inbox",
      instancePolicy: "multiple",
    });
  });

  it("opens installed apps as independent workspace tabs", () => {
    expect(
      workspaceSurfaceFromRoute(
        "/apps/quick_convert?name=Quick+Convert&selected=%2FUsers%2Fmisty%2Fmovie.mov",
      ),
    ).toMatchObject({
      surfaceId: "extension",
      groupKey: "app:quick_convert",
      instancePolicy: "multiple",
      title: "Quick Convert",
    });
  });

  it("keeps Code route navigation reusable while allowing explicit global Code tabs", () => {
    expect(workspaceSurfaceFromRoute("/code")).toMatchObject({
      surfaceId: "code",
      groupKey: "tool:code",
      instancePolicy: "multiple",
    });
  });
});
