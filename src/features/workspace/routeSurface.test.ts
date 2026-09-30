import { describe, expect, it } from "vitest";
import { workspaceSurfaceFromRoute, workspaceViewMatchesRoute } from "./routeSurface";

describe("browser workspace deep links", () => {
  it.each(["/settings", "/account", "/signin", "/register", "/activity"])(
    "keeps %s outside the workspace",
    (route) => {
      expect(workspaceSurfaceFromRoute(route)).toBeNull();
    },
  );
  it.each(["/new", "/browser", "/apps/journal", "/discover"])(
    "opens %s as a global browser tab",
    (route) => {
      expect(workspaceSurfaceFromRoute(route)).toMatchObject({
        surfaceId: "browser",
        groupKey: "tool:browser",
        scopeKey: "global",
        route: "/browser",
        instancePolicy: "multiple",
        state: { url: "https://www.google.com" },
      });
    },
  );
  it("preserves browser deep-link addresses", () => {
    expect(
      workspaceSurfaceFromRoute("/browser?url=https%3A%2F%2Fexample.com%2Freport")?.state,
    ).toMatchObject({ url: "https://example.com/report" });
  });
  it.each(["/files", "/apps/files"])(
    "opens %s directly and preserves device-local selections",
    (route) => {
      expect(
        workspaceSurfaceFromRoute(`${route}?path=%2FUsers%2Fada&select=notes.txt`),
      ).toMatchObject({
        surfaceId: "files",
        groupKey: "tool:files",
        scopeKey: "global",
        route: "/files?path=%2FUsers%2Fada&select=notes.txt",
        instancePolicy: "single",
      });
    },
  );
  it("keeps agent run links intact", () => {
    expect(workspaceSurfaceFromRoute("/agents?run=task-1")).toMatchObject({
      surfaceId: "agents",
      route: "/agents?run=task-1",
      scopeKey: "global",
    });
  });
  it("matches tools independently of their selected subsection", () => {
    const tab = { surfaceId: "files" as const, groupKey: "tool:files" as const };
    expect(workspaceViewMatchesRoute(tab, "/files?view=recent")).toBe(true);
    expect(workspaceViewMatchesRoute(tab, "/agents")).toBe(false);
  });
});

it("restores Space tools as split-capable surfaces in the current global workspace", () => {
  expect(workspaceSurfaceFromRoute("/spaces/family/planner/tasks/board")).toMatchObject({
    surfaceId: "space",
    groupKey: "space:family:planner",
    scopeKey: "global",
    route: "/spaces/family/planner/tasks/board",
  });
  expect(workspaceSurfaceFromRoute("/spaces")).toMatchObject({ surfaceId: "space" });
});

it("opens Home as a reusable workspace tab", () => {
  expect(workspaceSurfaceFromRoute("/home")).toMatchObject({
    surfaceId: "home",
    groupKey: "tool:home",
    title: "Home",
    route: "/home",
    instancePolicy: "single",
  });
});

it("opens Scheduled directly and preserves legacy task links", () => {
  for (const route of ["/scheduled?task=weekly", "/agents?view=scheduled&task=weekly"])
    expect(workspaceSurfaceFromRoute(route)).toMatchObject({
      surfaceId: "scheduled",
      groupKey: "tool:scheduled",
      route: "/scheduled?task=weekly",
      scopeKey: "global",
    });
});
