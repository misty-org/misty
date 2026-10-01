import { expect, it } from "vitest";
import { canonicalSpaceRoute } from "./spaceRouteNormalization";
it("preserves Journal-style entry points and section filters", () => {
  for (const route of [
    "/spaces/family/social",
    "/spaces/family/planner",
    "/spaces/family/planner?section=agenda",
    "/spaces/family/library?collection=deleted",
  ])
    expect(canonicalSpaceRoute(route)).toBe(route);
});
it("keeps existing conversation and task deep links", () => {
  expect(canonicalSpaceRoute("/spaces/family/social/misty?conversation=one")).toBe(
    "/spaces/family/social/misty?conversation=one",
  );
  expect(canonicalSpaceRoute("/spaces/family/tasks/list?task=one")).toBe(
    "/spaces/family/planner/tasks/list?task=one",
  );
});
