import { describe, expect, it } from "vitest";
import { sidebarStyles } from "@/features/explorer/components/ExplorerSidebarSupport";
import { opacityAwareColor } from "@/layouts/DesktopLayout/useDesktopFrameStyle";
import {
  desktopTitlebarClass,
  desktopWallpaperLayerClass,
  navbarBottomClass,
  navbarGroupClass,
} from "@/layouts/DesktopLayout/styles";

describe("desktop surface colors", () => {
  it("keeps theme tokens opaque when no wallpaper is active", () => {
    expect(opacityAwareColor("var(--misty-surface)", 0.42, false)).toBe("var(--misty-surface)");
  });

  it("turns theme tokens into opacity-aware colors over a wallpaper", () => {
    expect(opacityAwareColor("var(--misty-surface)", 0.82, true)).toBe(
      "color-mix(in srgb, var(--misty-surface) 82%, transparent)",
    );
  });

  it("clamps persisted opacity values to the valid CSS range", () => {
    expect(opacityAwareColor("var(--misty-bg)", -1, true)).toContain(" 0%");
    expect(opacityAwareColor("var(--misty-bg)", 2, true)).toContain(" 100%");
  });

  it("lets the custom titlebar reveal the app background", () => {
    expect(desktopTitlebarClass).toContain("misty-app-titlebar-bg");
    expect(desktopTitlebarClass).not.toContain("bg-transparent");
    expect(desktopWallpaperLayerClass).toContain("absolute");
    expect(desktopWallpaperLayerClass).toContain("row-span-full");
  });

  it("does not stack an opaque fallback beneath the Files sidebar", () => {
    expect(sidebarStyles.root).toContain("misty-files-panel-bg,transparent");
    expect(sidebarStyles.root).not.toContain("misty-files-panel-bg,var(--sidebar)");
  });

  it("scrolls overflowing primary navigation without moving its bottom controls", () => {
    expect(navbarGroupClass).toContain("min-h-0");
    expect(navbarGroupClass).toContain("flex-1");
    expect(navbarGroupClass).toContain("overflow-y-auto");
    expect(navbarGroupClass).toContain("[scrollbar-width:none]");
    expect(navbarGroupClass).toContain("[&::-webkit-scrollbar]:hidden");
    expect(navbarBottomClass).toContain("shrink-0");
  });
});
