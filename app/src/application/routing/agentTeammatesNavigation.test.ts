import { desktopNavItems, desktopRouteIdFromPath } from "@/application/routing/navigation";
import { describe, expect, it } from "vitest";

describe("first-class Agent navigation", () => {
  it("keeps available and coming-soon global destinations discoverable", () => {
    expect(desktopNavItems.map((item) => item.id)).toEqual([
      "home",
      "files",
      "transfers",
      "agents",
      "marketplace",
    ]);
    expect(desktopNavItems.map((item) => item.id)).not.toContain("spaces");
  });

  it("maps global destinations to their own app pages", () => {
    expect(desktopRouteIdFromPath("/inbox")).toBe("inbox");
    expect(desktopRouteIdFromPath("/files")).toBe("files");
    expect(desktopRouteIdFromPath("/agents")).toBe("agents");
    expect(desktopRouteIdFromPath("/assistant")).toBe("agents");
    expect(desktopRouteIdFromPath("/code")).toBe("code");
    expect(desktopRouteIdFromPath("/marketplace")).toBe("marketplace");
    expect(desktopRouteIdFromPath("/transfers")).toBe("transfers");
  });
});
expect(desktopRouteIdFromPath("/home")).toBe("home");
