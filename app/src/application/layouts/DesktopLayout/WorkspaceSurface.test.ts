import { describe, expect, it } from "vitest";
import { desktopFeatureForSurface, parseSpaceTabRoute } from "./WorkspaceSurface";

describe("desktop-only workspace surfaces", () => {
  it("keeps restored Transfers tabs behind the web download state", () => {
    expect(desktopFeatureForSurface("transfers")).toBe("Transfers");
  });

  it("leaves cloud-backed surfaces available", () => {
    expect(desktopFeatureForSurface("agents")).toBeNull();
    expect(desktopFeatureForSurface("space")).toBeNull();
  });
});

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

  it("keeps each Social provider page distinct, including legacy saved routes", () => {
    expect(parseSpaceTabRoute("/spaces/team/social/discord")).toMatchObject({
      section: "social",
      studioKind: "discord",
    });
    expect(parseSpaceTabRoute("/spaces/team/social?provider=instagram")).toMatchObject({
      section: "social",
      studioKind: "instagram",
    });
    expect(parseSpaceTabRoute("/spaces/team/social/messenger")).toMatchObject({
      section: "social",
      studioKind: "messenger",
    });
    expect(parseSpaceTabRoute("/spaces/team/social/x")).toMatchObject({
      section: "social",
      studioKind: "x",
    });
  });

  it("returns null for anything that is not a Space route", () => {
    expect(parseSpaceTabRoute("/files")).toBeNull();
    expect(parseSpaceTabRoute("/spaces")).toBeNull();
  });
});
