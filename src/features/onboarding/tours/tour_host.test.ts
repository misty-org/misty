import { describe, expect, it } from "vitest";
import { tourForPage } from "./TourHost";

describe("tourForPage", () => {
  it("names the tour for the page in view", () => {
    expect(tourForPage("/agents")).toBe("welcome");
    expect(tourForPage("/agents")).toBe("welcome");
    expect(tourForPage("/agents")).toBe("welcome");
    expect(tourForPage("/agents")).toBe("welcome");
    expect(tourForPage("/agents")).toBe("welcome");
    expect(tourForPage("/spaces/abc")).toBe("space");
    expect(tourForPage("/spaces/abc/home")).toBe("space");
    expect(tourForPage("/spaces/abc/chat")).toBe("space-chat");
    expect(tourForPage("/spaces/abc/files")).toBeNull();
    expect(tourForPage("/spaces/abc/library")).toBeNull();
    expect(tourForPage("/spaces/abc/notes")).toBeNull();
    expect(tourForPage("/spaces/abc/members")).toBeNull();
    expect(tourForPage("/settings")).toBeNull();
  });
});
