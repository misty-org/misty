import { beforeEach, describe, expect, it } from "vitest";
import {
  rememberSpaceSubpageRoute,
  rememberedJournalRoute,
  rememberedPlannerRoute,
} from "./spacesShell/spaceSubpageMemory";

describe("Space subpage route memory", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores each Planner page with its own view, filters, date, and selection", () => {
    rememberSpaceSubpageRoute(
      "account-1",
      "space-1",
      "/spaces/space-1/planner/tasks/list?mine=1&due=week#today",
    );
    rememberSpaceSubpageRoute(
      "account-1",
      "space-1",
      "/spaces/space-1/planner/agenda/week?date=2026-08-17",
    );
    rememberSpaceSubpageRoute("account-1", "space-1", "/spaces/space-1/planner/goals");
    rememberSpaceSubpageRoute("account-1", "space-1", "/spaces/space-1/planner/milestones");
    rememberSpaceSubpageRoute(
      "account-1",
      "space-1",
      "/spaces/space-1/planner/roadmaps/map-1?node=risk-2",
    );

    expect(rememberedPlannerRoute("account-1", "space-1", "tasks")).toBe(
      "/spaces/space-1/planner/tasks/list?mine=1&due=week#today",
    );
    expect(rememberedPlannerRoute("account-1", "space-1", "agenda")).toBe(
      "/spaces/space-1/planner/agenda/week?date=2026-08-17",
    );
    expect(rememberedPlannerRoute("account-1", "space-1", "goals")).toBe(
      "/spaces/space-1/planner/goals",
    );
    expect(rememberedPlannerRoute("account-1", "space-1", "milestones")).toBe(
      "/spaces/space-1/planner/milestones",
    );
    expect(rememberedPlannerRoute("account-1", "space-1", "roadmaps")).toBe(
      "/spaces/space-1/planner/roadmaps/map-1?node=risk-2",
    );
    expect(rememberedPlannerRoute("account-1", "space-1")).toBe(
      "/spaces/space-1/planner/roadmaps/map-1?node=risk-2",
    );
  });

  it("remembers Journal pages independently and isolates accounts and Spaces", () => {
    rememberSpaceSubpageRoute("account-1", "space-1", "/spaces/space-1/notes?note=note-4");
    rememberSpaceSubpageRoute("account-1", "space-1", "/spaces/space-1/drawings/drawing-7");

    expect(rememberedJournalRoute("account-1", "space-1", "notes")).toBe(
      "/spaces/space-1/notes?note=note-4",
    );
    expect(rememberedJournalRoute("account-1", "space-1", "drawings")).toBe(
      "/spaces/space-1/drawings/drawing-7",
    );
    expect(rememberedJournalRoute("account-2", "space-1", "drawings")).toBe(
      "/spaces/space-1/drawings",
    );
    expect(rememberedJournalRoute("account-1", "space-2", "notes")).toBe("/spaces/space-2/notes");
  });
});
