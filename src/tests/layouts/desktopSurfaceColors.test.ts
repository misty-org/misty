import { describe, expect, it } from "vitest";
import { sidebarStyles } from "@/features/explorer/components/ExplorerSidebarSupport";
import {
  desktopTitlebarClass,
  desktopWallpaperLayerClass,
  navbarBottomClass,
  navbarGroupClass,
  navButtonActiveClass,
  navItemBaseClass,
  navLinkActiveClass,
  navLinkBaseClass,
} from "@/layouts/DesktopLayout/styles";

describe("desktop warm charcoal surfaces", () => {
  it("uses opaque workspace and sidebar surfaces", () => {
    expect(desktopTitlebarClass).toContain("bg-charcoal-workspace");
    expect(desktopTitlebarClass).toContain("border-charcoal-border");
    expect(desktopTitlebarClass).not.toContain("var(");
    expect(desktopWallpaperLayerClass).toBe("hidden");
    expect(sidebarStyles.root).toContain("bg-charcoal-sidebar");
    expect(sidebarStyles.root).not.toContain("transparent");
  });

  it("scrolls overflowing primary navigation without moving its bottom controls", () => {
    expect(navbarGroupClass).toContain("min-h-0");
    expect(navbarGroupClass).toContain("flex-1");
    expect(navbarGroupClass).toContain("overflow-y-auto");
    expect(navbarGroupClass).toContain("[scrollbar-width:none]");
    expect(navbarGroupClass).toContain("[&::-webkit-scrollbar]:hidden");
    expect(navbarBottomClass).toContain("shrink-0");
  });

  // Selection is an edge marker and hover only brightens: no interactive
  // surface in the navbar grows a background of its own.
  it("marks the active destination with an edge line rather than a filled tile", () => {
    expect(navLinkBaseClass).toContain("rounded-lg");
    expect(navLinkBaseClass).toContain("text-cream-muted");
    expect(navLinkActiveClass).toContain("misty-navbar-marker-side");
    expect(navLinkActiveClass).toContain("text-cream-bright");
    expect(navButtonActiveClass).toContain("misty-navbar-marker-side");
    expect(navLinkActiveClass).not.toContain("bg-charcoal-active");
    expect(navItemBaseClass).not.toContain("hover:bg-");
  });
});
