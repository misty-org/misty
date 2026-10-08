import { describe, expect, it } from "vitest";
import { workspaceSurfaceFromRoute } from "./routeSurface";

describe("browser workspace deep links", () => {
  it.each(["/settings", "/account", "/signin", "/register"])(
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
        scopeKey: "space:personal",
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
    "no longer opens %s as a tool; Files moved to Kura",
    (route) => {
      expect(
        workspaceSurfaceFromRoute(`${route}?path=%2FUsers%2Fada&select=notes.txt`)?.surfaceId,
      ).not.toBe("files");
    },
  );
  it("keeps agent run links intact", () => {
    expect(workspaceSurfaceFromRoute("/agents?run=task-1")).toMatchObject({
      surfaceId: "agents",
      route: "/agents?run=task-1",
      scopeKey: "space:personal",
    });
  });
});

it("restores Space tools as split-capable surfaces in the current global workspace", () => {
  expect(workspaceSurfaceFromRoute("/spaces/family/library")).toMatchObject({
    surfaceId: "space",
    groupKey: "space:family:library",
    scopeKey: "space:personal",
    route: "/spaces/family/library",
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
      scopeKey: "space:personal",
    });
    const url = new URL(surface.route!, "https://misty.local");
    expect(url.pathname).toBe("/agents");
    expect(url.searchParams.get("view")).toBe("scheduled");
    expect(url.searchParams.get("task")).toBe("weekly");
  }
});
