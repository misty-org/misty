import { describe, expect, it } from "vitest";
import { workspaceSurfaceFromRoute, workspaceTabMatchesRoute } from "./routeSurface";

describe("workspace deep links", () => {
  it("keeps Settings outside the desktop workspace", () => {
    expect(workspaceSurfaceFromRoute("/settings")).toBeNull();
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
    ["/extensions", "extensions"],
  ])("maps %s to the %s surface", (route, surfaceId) => {
    expect(workspaceSurfaceFromRoute(route)?.surfaceId).toBe(surfaceId);
  });

  it("opens Inbox as one account-level tool surface", () => {
    expect(workspaceSurfaceFromRoute("/inbox")).toMatchObject({
      surfaceId: "inbox",
      groupKey: "tool:inbox",
      instancePolicy: "single",
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

describe("home route", () => {
  it("resolves to a stackable Home surface", () => {
    // Home used to resolve to null, which meant it could only switch scope and
    // never open a tab. It is an ordinary, stackable tab now.
    expect(workspaceSurfaceFromRoute("/home")).toMatchObject({
      surfaceId: "home",
      groupKey: "tool:home",
      instancePolicy: "multiple",
    });
  });
});
