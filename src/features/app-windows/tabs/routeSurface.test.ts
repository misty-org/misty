import { describe, expect, it } from "vitest";
import { isRetiredWebRoute, workspaceSurfaceFromRoute } from "./routeSurface";

describe("browser workspace deep links", () => {
  it.each(["/settings", "/account", "/signin", "/register"])(
    "keeps %s outside the workspace",
    (route) => {
      expect(workspaceSurfaceFromRoute(route)).toBeNull();
    },
  );
  it.each([
    "/",
    "/new",
    "/browser",
    "/browser?url=https%3A%2F%2Fexample.com",
    "/apps/journal",
    "/discover",
  ])("opens nothing for %s, which once opened a web page for the person", (route) => {
    expect(workspaceSurfaceFromRoute(route)).toBeNull();
    expect(isRetiredWebRoute(route)).toBe(true);
  });
  it.each(["/agents", "/apps/agents", "/spaces/family/chat", "/settings", "/scheduled"])(
    "doesn't take %s for a web page's route",
    (route) => expect(isRetiredWebRoute(route)).toBe(false),
  );
  it.each(["/files", "/apps/files"])(
    "no longer opens %s as a tool; Files moved to Kura",
    (route) => {
      expect(workspaceSurfaceFromRoute(`${route}?path=%2FUsers%2Fada&select=notes.txt`)).toBeNull();
    },
  );
  it("keeps agent run links intact", () => {
    expect(workspaceSurfaceFromRoute("/agents?run=task-1")).toMatchObject({
      surfaceId: "agents",
      route: "/agents?run=task-1",
    });
  });
});

it("restores Space tools as split-capable surfaces in the current global workspace", () => {
  expect(workspaceSurfaceFromRoute("/spaces/family/library")).toMatchObject({
    surfaceId: "space",
    groupKey: "space:family:library",
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
    });
    const url = new URL(surface.route!, "https://misty.local");
    expect(url.pathname).toBe("/agents");
    expect(url.searchParams.get("view")).toBe("scheduled");
    expect(url.searchParams.get("task")).toBe("weekly");
  }
});
