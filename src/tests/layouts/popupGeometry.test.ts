import { describe, expect, it } from "vitest";
import { adjacentPanelLeft, fitFloatingPanel } from "@/layouts/DesktopLayout/popupGeometry";

describe("popup geometry", () => {
  it("keeps a tall panel between the titlebar and viewport bottom", () => {
    const panel = fitFloatingPanel(90, 400, 286, 600, {
      width: 900,
      height: 500,
      topInset: 28,
      gutter: 8,
    });

    expect(panel).toEqual({
      left: 90,
      top: 36,
      width: 286,
      height: 456,
      maxHeight: 456,
    });
  });

  it("shrinks and clamps a panel inside a narrow viewport", () => {
    const panel = fitFloatingPanel(200, -20, 320, 240, {
      width: 300,
      height: 400,
      gutter: 8,
    });

    expect(panel.left).toBe(8);
    expect(panel.top).toBe(8);
    expect(panel.width).toBe(284);
  });

  it("opens an adjacent panel on the side with room", () => {
    expect(
      adjacentPanelLeft({
        anchorLeft: 600,
        anchorWidth: 286,
        panelWidth: 320,
        viewportWidth: 920,
      }),
    ).toBe(272);

    expect(
      adjacentPanelLeft({
        anchorLeft: 20,
        anchorWidth: 286,
        panelWidth: 320,
        viewportWidth: 920,
      }),
    ).toBe(314);
  });
});
