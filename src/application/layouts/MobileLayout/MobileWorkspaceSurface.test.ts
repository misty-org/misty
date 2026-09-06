import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mobileSurfaceRegistry } from "./MobileWorkspaceSurface";

describe("mobile workspace surface registry", () => {
  it("routes every supported app to a mobile composition", () => {
    expect(mobileSurfaceRegistry).toMatchObject({
      space: "space",
      inbox: "desktop-handoff",
      browser: "desktop-handoff",
      files: "desktop-handoff",
      agents: "desktop-handoff",
      "official-app": "official-app",
    });
  });

  it("keeps desktop handoffs and excluded extensions out of the mobile renderer", () => {
    expect(mobileSurfaceRegistry.code).toBe("desktop-handoff");
    expect(mobileSurfaceRegistry.terminal).toBe("desktop-handoff");
    expect(mobileSurfaceRegistry.transfers).toBe("desktop-handoff");
    expect(mobileSurfaceRegistry.extension).toBe("excluded");
    expect(mobileSurfaceRegistry.marketplace).toBe("excluded");
  });

  it("does not import desktop or extension surface code", () => {
    const source = readFileSync(
      join(process.cwd(), "src/application/layouts/MobileLayout/MobileWorkspaceSurface.tsx"),
      "utf8",
    );
    expect(source).not.toContain("DesktopLayout");
    expect(source).not.toContain("features/extensions");
    expect(source).not.toContain("features/marketplace");
    expect(source).not.toContain("features/terminal");
    expect(source).not.toContain("features/developer-workspace");
  });
});
