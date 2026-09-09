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

  it("redirects legacy Space tools into App-owned tabs", () => {
    expect(workspaceSurfaceFromRoute("/spaces/product%20launch/planner")).toMatchObject({
      surfaceId: "official-app",
      groupKey: "app:planner",
      title: "Planner",
      route: "/apps/planner?space=product+launch",
    });
  });

  it("keeps Social separate and maps legacy Chat routes into its group", () => {
    expect(workspaceSurfaceFromRoute("/spaces/family/social")).toMatchObject({
      groupKey: "app:chat",
      title: "Social",
      route: "/apps/social?space=family",
    });
    expect(workspaceSurfaceFromRoute("/spaces/family/chat")).toMatchObject({
      groupKey: "app:chat",
      title: "Social",
    });
  });

  it("preserves the selected Social provider in the workspace tab route", () => {
    const route = "/spaces/family/social/messenger";

    expect(workspaceSurfaceFromRoute(route)).toMatchObject({
      groupKey: "app:chat",
      route: "/apps/social?space=family&provider=messenger",
    });
  });

  it("matches nested routes only within the same Space tool tab", () => {
    const tab = {
      surfaceId: "official-app" as const,
      groupKey: "app:journal" as const,
    };

    expect(workspaceTabMatchesRoute(tab, "/apps/journal?space=product%20launch")).toBe(true);
    expect(workspaceTabMatchesRoute(tab, "/apps/journal/drawings/one")).toBe(true);
    expect(workspaceTabMatchesRoute(tab, "/apps/planner?space=product%20launch")).toBe(false);
  });

  it.each([
    ["/browser", "official-app"],
    ["/inbox", "official-app"],
    ["/terminal", "official-app"],
    ["/code", "official-app"],
    ["/files", "official-app"],
    ["/agents", "official-app"],
    ["/transfers", "official-app"],
    ["/discover", "marketplace"],
  ])("maps %s to the %s surface", (route, surfaceId) => {
    expect(workspaceSurfaceFromRoute(route)?.surfaceId).toBe(surfaceId);
  });

  it("opens coming-soon launch surfaces as singleton tabs", () => {
    for (const route of ["/discover"]) {
      expect(workspaceSurfaceFromRoute(route)?.instancePolicy).toBe("single");
    }
  });

  it.each(["/transfers", "/apps/transfers", "/apps/files?view=transfers"])(
    "opens %s as the Files subsection",
    (route) => {
      expect(workspaceSurfaceFromRoute(route)).toMatchObject({
        surfaceId: "official-app",
        groupKey: "app:files",
        instanceKey: "files",
        route: "/apps/files?view=transfers",
      });
    },
  );

  it("does not preserve legacy catalog aliases", () => {
    expect(workspaceSurfaceFromRoute("/marketplace")).toBeNull();
    expect(workspaceSurfaceFromRoute("/store")).toBeNull();
  });

  it("opens legacy Inbox through the account App runtime", () => {
    expect(workspaceSurfaceFromRoute("/inbox")).toMatchObject({
      surfaceId: "official-app",
      groupKey: "app:inbox",
      route: "/apps/inbox",
      instancePolicy: "multiple",
    });
  });

  it("opens installed apps as independent workspace tabs", () => {
    expect(
      workspaceSurfaceFromRoute(
        "/apps/quick_convert?name=Quick+Convert&selected=%2FUsers%2Fmisty%2Fmovie.mov",
      ),
    ).toMatchObject({
      surfaceId: "official-app",
      groupKey: "app:quick_convert",
      instancePolicy: "multiple",
      title: "Quick_convert",
    });
  });

  it("opens every acquired built-in through the App runtime", () => {
    expect(workspaceSurfaceFromRoute("/apps/files")).toMatchObject({
      surfaceId: "official-app",
      groupKey: "app:files",
      route: "/apps/files",
    });
    expect(workspaceSurfaceFromRoute("/apps/social?space=family")).toMatchObject({
      surfaceId: "official-app",
      groupKey: "app:chat",
      title: "Social",
    });
    expect(workspaceSurfaceFromRoute("/apps/planner?space=family")).toMatchObject({
      surfaceId: "official-app",
      groupKey: "app:planner",
      route: "/apps/planner?space=family",
    });
  });

  it("canonicalizes legacy Code routes into the Code App", () => {
    expect(workspaceSurfaceFromRoute("/code")).toMatchObject({
      surfaceId: "official-app",
      groupKey: "app:code",
      route: "/apps/code",
      instancePolicy: "multiple",
    });
  });
});
