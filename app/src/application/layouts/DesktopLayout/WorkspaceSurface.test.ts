import { describe, expect, it } from "vitest";
import { parseSpaceTabRoute } from "./WorkspaceSurface";

describe("space pane route", () => {
  it("reads the Space and section a pane should render", () => {
    expect(parseSpaceTabRoute("/spaces/family/chat")).toEqual({
      spaceId: "family",
      section: "chat",
      studioKind: "",
    });
  });

  it("decodes the Space id and keeps the trailing segment", () => {
    expect(parseSpaceTabRoute("/spaces/product%20launch/settings/members")).toEqual({
      spaceId: "product launch",
      section: "settings",
      studioKind: "members",
    });
  });

  it("ignores query and hash, which planner views carry", () => {
    expect(parseSpaceTabRoute("/spaces/team/planner/tasks?status=open#top")).toMatchObject({
      spaceId: "team",
      section: "planner",
      studioKind: "tasks",
    });
  });

  it("returns null for anything that is not a Space route", () => {
    expect(parseSpaceTabRoute("/files")).toBeNull();
    expect(parseSpaceTabRoute("/spaces")).toBeNull();
  });
});
