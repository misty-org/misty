import { describe, expect, it } from "vitest";
import { workspaceSurfaceFromRoute, workspaceTabMatchesRoute } from "./routeSurface";

describe("workspace deep links", () => {
  it("keeps Settings outside the desktop workspace", () => {
    expect(workspaceSurfaceFromRoute("/settings")).toBeNull();
  });

  it("opens global Home without binding its route to a Space", () => {
    expect(workspaceSurfaceFromRoute("/home")).toMatchObject({
      surfaceId: "home",
      groupKey: "tool:home",
      route: "/home",
      instancePolicy: "single",
    });
    expect(workspaceSurfaceFromRoute("/home")?.scopeKey).toBeUndefined();
  });

  it("opens Home inside its Space scope", () => {
    expect(workspaceSurfaceFromRoute("/spaces/family/home")).toMatchObject({
      surfaceId: "space",
      groupKey: "space:family",
      scopeKey: "space:family",
      title: "Home",
    });
  });

  it("opens collaborative tools as built-in Space tabs", () => {
    expect(workspaceSurfaceFromRoute("/spaces/product%20launch/planner")).toMatchObject({
      surfaceId: "space",
      groupKey: "space:product launch:planner",
      title: "Planner",
      route: "/spaces/product%20launch/planner/tasks/board",
    });
  });

  it("groups Chat routes within their Space", () => {
    expect(workspaceSurfaceFromRoute("/spaces/family/social")).toMatchObject({
      groupKey: "space:family:social",
      title: "Chat",
      route: "/spaces/family/social/misty",
    });
    expect(workspaceSurfaceFromRoute("/spaces/family/chat")).toMatchObject({
      groupKey: "space:family:social",
      title: "Chat",
    });
  });

  it("preserves the selected Social provider in the workspace tab route", () => {
    const route = "/spaces/family/social/messenger";

    expect(workspaceSurfaceFromRoute(route)).toMatchObject({
      groupKey: "app:chat",
      route: "/apps/social?provider=messenger&space=family",
    });
  });

  it("matches nested routes only within the same Space tool tab", () => {
    const tab = {
      surfaceId: "space" as const,
      groupKey: "space:product launch:journal" as const,
    };

    expect(workspaceTabMatchesRoute(tab, "/apps/journal?space=product%20launch")).toBe(true);
    expect(workspaceTabMatchesRoute(tab, "/spaces/product%20launch/drawings/one")).toBe(true);
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

  it("keeps personal apps in the App runtime and restores shared links to Spaces", () => {
    expect(workspaceSurfaceFromRoute("/apps/files")).toMatchObject({
      surfaceId: "official-app",
      groupKey: "app:files",
      route: "/apps/files",
    });
    expect(workspaceSurfaceFromRoute("/apps/social?space=family")).toMatchObject({
      surfaceId: "space",
      groupKey: "space:family:social",
      title: "Chat",
    });
    expect(workspaceSurfaceFromRoute("/apps/planner?space=family")).toMatchObject({
      surfaceId: "space",
      groupKey: "space:family:planner",
      route: "/spaces/family/planner/tasks/board",
    });
  });

  it("does not change the selected Space when a personal app carries its saved context", () => {
    expect(workspaceSurfaceFromRoute("/apps/browser?space=family")?.scopeKey).toBeUndefined();
    expect(
      workspaceSurfaceFromRoute("/apps/planner?provider=notion&space=family")?.scopeKey,
    ).toBeUndefined();
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

it("distinguishes personal Storage from the shared Space Library", () => {
  expect(workspaceSurfaceFromRoute("/apps/library?provider=google-drive")?.title).toBe("Storage");
  expect(workspaceSurfaceFromRoute("/spaces/family/library")?.title).toBe("Library");
});
