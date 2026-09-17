import { describe, expect, it } from "vitest";
import { spaceToolRouteFromAppRoute } from "./spaceAppRoute";

describe("shared content links", () => {
  it("preserves the Space and selected note", () => {
    expect(
      spaceToolRouteFromAppRoute("/apps/journal?provider=misty&space=team&view=notes&note=one"),
    ).toBe("/spaces/team/notes?note=one");
  });
  it("preserves a drawing deep link", () => {
    expect(spaceToolRouteFromAppRoute("/apps/journal?space=team&view=drawings&drawing=one")).toBe(
      "/spaces/team/drawings/one?drawing=one",
    );
  });
  it("preserves planner subviews", () => {
    expect(spaceToolRouteFromAppRoute("/apps/planner?space=team&view=agenda&agendaView=week")).toBe(
      "/spaces/team/planner/agenda/week?view=agenda&agendaView=week",
    );
  });
  it.each([
    "/apps/planner?provider=notion&space=team",
    "/apps/journal",
    "/apps/library?view=integrations",
    "/apps/social?drawer=integrations",
  ])("leaves personal app navigation alone: %s", (route) => {
    expect(spaceToolRouteFromAppRoute(route, "team")).toBeNull();
  });
});
