import { desktopNavItems, desktopRouteIdFromPath } from "@/application/routing/navigation";
import { describe, expect, it } from "vitest";

describe("first-class Agent navigation", () => {
  it("puts global destinations in the primary rail", () => {
    expect(desktopNavItems.map((item) => item.id)).toEqual([
      "home",
      "files",
      "agents",
      "extensions",
    ]);
    expect(desktopNavItems.map((item) => item.id)).not.toContain("spaces");
    expect(desktopNavItems.map((item) => item.id)).not.toContain("transfers");
  });

  it("treats Home as a first-class desktop route", () => {
    expect(desktopRouteIdFromPath("/home")).toBe("home");
  });

  it("maps global destinations to their own app pages", () => {
    expect(desktopRouteIdFromPath("/inbox")).toBe("inbox");
    expect(desktopRouteIdFromPath("/files")).toBe("files");
    expect(desktopRouteIdFromPath("/agents")).toBe("agents");
    expect(desktopRouteIdFromPath("/assistant")).toBe("agents");
    expect(desktopRouteIdFromPath("/code")).toBe("code");
    expect(desktopRouteIdFromPath("/extensions")).toBe("extensions");
  });
});
