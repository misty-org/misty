import { describe, expect, it } from "vitest";
import { tourForPage } from "./TourHost";

describe("tourForPage", () => {
  it("names the tour for the page in view", () => {
    expect(tourForPage("/agents", "")).toBe("welcome");
    expect(tourForPage("/agents", "?view=lab")).toBe("lab");
    expect(tourForPage("/agents", "?view=studio")).toBe("welcome");
    expect(tourForPage("/agents", "?view=integrations")).toBe("welcome");
    expect(tourForPage("/agents", "?view=office")).toBe("welcome");
    expect(tourForPage("/agents", "?view=automations")).toBe("welcome");
    expect(tourForPage("/agents", "?view=lab&item=notebook:n1")).toBe("notebook");
    expect(tourForPage("/spaces/abc", "")).toBe("space");
    expect(tourForPage("/spaces/abc/home", "")).toBe("space");
    expect(tourForPage("/spaces/abc/chat", "")).toBe("space-chat");
    expect(tourForPage("/spaces/abc/notes", "")).toBe("docs");
    expect(tourForPage("/spaces/abc/notes", "?note=n1")).toBe("doc");
    expect(tourForPage("/spaces/abc/drawings", "")).toBe("whiteboards");
    expect(tourForPage("/spaces/abc/drawings/d1", "")).toBe("drawing");
    expect(tourForPage("/spaces/abc/slides", "")).toBe("slides");
    expect(tourForPage("/spaces/abc/slides/k1", "")).toBe("deck");
    expect(tourForPage("/spaces/abc/data", "")).toBe("data");
    expect(tourForPage("/spaces/abc/data/w1", "")).toBe("workbook");
    expect(tourForPage("/spaces/abc/library", "")).toBe("library");
    expect(tourForPage("/spaces/abc/lab", "")).toBe("lab");
    expect(tourForPage("/spaces/abc/lab", "?item=notebook:n1")).toBe("notebook");
    expect(tourForPage("/spaces/abc/planner", "")).toBe("planner");
    expect(tourForPage("/spaces/abc/calendar", "")).toBe("calendar");
    expect(tourForPage("/spaces/abc/members", "")).toBeNull();
    expect(tourForPage("/settings", "")).toBeNull();
  });
});
