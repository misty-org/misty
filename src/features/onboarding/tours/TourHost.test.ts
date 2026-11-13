import { describe, expect, it } from "vitest";
import { tourForPage } from "./TourHost";

describe("tourForPage", () => {
  it("names the tour for the page in view", () => {
    expect(tourForPage("/agents", "")).toBe("welcome");
    expect(tourForPage("/agents", "?view=lab")).toBe("lab");
    expect(tourForPage("/agents", "?view=studio")).toBe("studio");
    expect(tourForPage("/agents", "?view=integrations")).toBe("integrations");
    expect(tourForPage("/agents", "?view=office")).toBe("studio");
    expect(tourForPage("/agents", "?view=automations")).toBe("welcome");
    expect(tourForPage("/agents", "?view=lab&item=notebook:n1")).toBe("notebook");
    expect(tourForPage("/spaces/abc", "")).toBe("space");
    expect(tourForPage("/spaces/abc/home", "")).toBe("space");
    expect(tourForPage("/spaces/abc/chat", "")).toBe("space-chat");
    expect(tourForPage("/spaces/abc/notes", "")).toBe("docs");
    expect(tourForPage("/spaces/abc/notes", "?note=n1")).toBe("doc");
    expect(tourForPage("/spaces/abc/drawings", "")).toBe("docs");
    expect(tourForPage("/spaces/abc/drawings/d1", "")).toBe("drawing");
    expect(tourForPage("/spaces/abc/library", "")).toBe("library");
    expect(tourForPage("/spaces/abc/planner", "")).toBe("planner");
    expect(tourForPage("/spaces/abc/calendar", "")).toBe("calendar");
    expect(tourForPage("/spaces/abc/members", "")).toBeNull();
    expect(tourForPage("/settings", "")).toBeNull();
  });
});
