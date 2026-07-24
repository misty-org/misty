import { describe, expect, it } from "vitest";
import { opacityAwareColor } from "@/layouts/DesktopLayout/useDesktopFrameStyle";
import { desktopTitlebarClass, desktopWallpaperLayerClass } from "@/layouts/DesktopLayout/styles";

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
});
