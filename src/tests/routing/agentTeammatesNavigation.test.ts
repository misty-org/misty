import { describe, expect, it } from "vitest";
import { desktopNavItems, desktopRouteIdFromPath } from "@/routing/navigation";

describe("first-class Agent navigation", () => {
  it("moves workspace modes and Agents out of the primary rail", () => {
    expect(desktopNavItems.map((item) => item.id)).not.toContain("spaces");
    expect(desktopNavItems.map((item) => item.id)).not.toContain("files");
    expect(desktopNavItems.map((item) => item.id)).not.toContain("extensions");
    expect(desktopNavItems.map((item) => item.id)).not.toContain("agents");
  });

  it("maps legacy Agent routes to Spaces for compatible app chrome", () => {
    expect(desktopRouteIdFromPath("/agents")).toBe("spaces");
    expect(desktopRouteIdFromPath("/assistant")).toBe("spaces");
  });
});
