import { describe, expect, it } from "vitest";
import { tourForPage } from "./TourHost";

describe("tourForPage", () => {
  it("names the tour for the page in view", () => {
    expect(tourForPage("/agents", "")).toBe("welcome");
    expect(tourForPage("/agents", "?view=lab")).toBe("lab");
    expect(tourForPage("/agents", "?view=studio")).toBe("studio");
    expect(tourForPage("/agents", "?view=integrations")).toBe("integrations");
    expect(tourForPage("/spaces/abc", "")).toBe("space");
    expect(tourForPage("/spaces/abc/notes", "")).toBeNull();
    expect(tourForPage("/settings", "")).toBeNull();
  });
});
