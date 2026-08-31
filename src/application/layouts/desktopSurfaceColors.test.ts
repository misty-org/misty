import {
  desktopTitlebarClass,
  desktopWallpaperLayerClass,
  navbarBottomClass,
  navbarGroupClass,
  navbarSpacesClass,
  navButtonActiveClass,
  navIconOnlyItemBaseClass,
  navItemBaseClass,
  navLinkActiveClass,
  navLinkBaseClass,
} from "@/application/layouts/DesktopLayout/styles";
import { sidebarStyles } from "@/features/files/explorer/components/ExplorerSidebarSupport";
import { describe, expect, it } from "vitest";

describe("desktop warm charcoal surfaces", () => {
  it("uses opaque workspace and sidebar surfaces", () => {
    expect(desktopTitlebarClass).not.toContain("bg-charcoal-workspace");
    expect(desktopTitlebarClass).not.toContain("border-charcoal-border");
    expect(desktopTitlebarClass).not.toContain("var(");
    expect(desktopWallpaperLayerClass).toBe("hidden");
    expect(sidebarStyles.root).toContain("bg-charcoal-sidebar");
    expect(sidebarStyles.root).not.toContain("transparent");
  });

  it("scrolls Spaces without moving global navigation or bottom controls", () => {
    expect(navbarGroupClass).toContain("shrink-0");
    expect(navbarGroupClass).not.toContain("overflow-y-auto");
    expect(navbarSpacesClass).toContain("min-h-0");
    expect(navbarSpacesClass).toContain("flex-1");
    expect(navbarSpacesClass).toContain("overflow-y-auto");
    expect(navbarSpacesClass).toContain("[scrollbar-width:none]");
    expect(navbarSpacesClass).toContain("[&::-webkit-scrollbar]:hidden");
    expect(navbarBottomClass).toContain("shrink-0");
  });

  // Selection is an edge marker and hover only brightens: no interactive
  // surface in the navbar grows a background of its own.
  it("marks the active destination with an edge line rather than a filled tile", () => {
    expect(navLinkBaseClass).toContain("rounded-lg");
    expect(navLinkBaseClass).toContain("text-cream-muted");
    expect(navLinkBaseClass).toContain("misty-navbar-marker-side");
    expect(navIconOnlyItemBaseClass).toContain("misty-navbar-marker-side");
    expect(navLinkActiveClass).toContain("text-cream-bright");
    expect(navButtonActiveClass).toContain("text-cream-bright");
    expect(navLinkActiveClass).not.toContain("bg-charcoal-active");
    expect(navItemBaseClass).not.toContain("hover:bg-");
  });
});
