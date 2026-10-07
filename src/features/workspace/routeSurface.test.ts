import { describe, expect, it } from "vitest";
import { workspaceSurfaceFromRoute } from "./routeSurface";

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

it("does not open the retired Home page as a tab", () => {
  expect(workspaceSurfaceFromRoute("/home")).toBeNull();
});

it("opens schedule links inside Agents and preserves the task", () => {
  for (const route of ["/scheduled?task=weekly", "/agents?view=scheduled&task=weekly"]) {
    const surface = workspaceSurfaceFromRoute(route)!;
    expect(surface).toMatchObject({
      surfaceId: "agents",
      groupKey: "tool:agents",
      scopeKey: "global",
    });
    const url = new URL(surface.route!, "https://misty.local");
    expect(url.pathname).toBe("/agents");
    expect(url.searchParams.get("view")).toBe("scheduled");
    expect(url.searchParams.get("task")).toBe("weekly");
  }
});
