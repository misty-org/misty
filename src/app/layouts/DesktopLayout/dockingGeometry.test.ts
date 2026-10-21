import { describe, expect, it } from "vitest";
import { dockingGeometry, dockingMetrics } from "./dockingGeometry";
import { dockPositions } from "@/features/app-shell/dockingLayout";

const layouts = dockPositions.flatMap((navigation) =>
  dockPositions.map((tabs) => ({ navigation, tabs })),
);
describe.each(layouts)("$navigation navigation / $tabs tabs", (layout) => {
  it.each([false, true])("reserves chrome and only occupied edges (auto-hide: %s)", (autoHide) => {
    const geometry = dockingGeometry({ ...layout, autoHide });
    expect(geometry.content.gridColumn).toBe(2);
    expect(geometry.content.gridRow).toBe(layout.navigation === "top" && !autoHide ? 3 : "1 / 4");
    const size = autoHide
      ? 0
      : ["left", "right"].includes(layout.navigation)
        ? dockingMetrics.rail
        : dockingMetrics.horizontalRail;
    expect(geometry.frame.gridTemplateColumns).toBe(
      `${layout.navigation === "left" ? size : 0}px minmax(0, 1fr) ${layout.navigation === "right" ? size : 0}px`,
    );
    const top =
      layout.navigation === "top" ? size : layout.tabs === "top" ? dockingMetrics.tabStrip : 38;
    const bottom = layout.navigation === "bottom" ? size : 0;
    expect(geometry.frame.gridTemplateRows).toBe(`${top}px 0px minmax(0, 1fr) ${bottom}px`);
    for (const edge of dockPositions)
      expect(geometry.frame[`--pane-seam-${edge}`]).toBe(
        (layout.tabs === "top" || layout.tabs === "bottom") && edge === layout.tabs
          ? "1px"
          : `${dockingMetrics.paneMargin}px`,
      );
    expect(geometry.floating[layout.navigation]).toBe(0);
    if (layout.tabs === "top") {
      // Tabs never occupy native traffic lights, even with hidden navigation.
      expect(
        geometry.titlebarInsets!.left +
          (!autoHide && layout.navigation === "left" ? dockingMetrics.rail : 0),
      ).toBe(layout.navigation === "top" && !autoHide ? 8 : 92);
    } else expect(geometry.titlebarInsets).toBeUndefined();
  });
});
it("hangs a horizontal strip's tabs from the page's top seam", () => {
  const frame = dockingGeometry({ navigation: "left", tabs: "top" }).frame;
  expect(frame["--pane-seam-top"]).toBe("1px");
  expect(frame["--pane-seam-left"]).toBe(`${dockingMetrics.paneMargin}px`);
  expect(frame["--pane-corner-top-left"]).toBe("12px");
  expect(frame["--pane-corner-bottom-right"]).toBe(
    `${dockingMetrics.paneMargin + dockingMetrics.paneRadius}px`,
  );
});
it("makes the page a rounded pane with an even margin beside vertical tabs", () => {
  const frame = dockingGeometry({ navigation: "left", tabs: "left" }).frame;
  for (const edge of dockPositions)
    expect(frame[`--pane-seam-${edge}`]).toBe(`${dockingMetrics.paneMargin}px`);
  expect(frame["--pane-corner-bottom-right"]).toBe(
    `${dockingMetrics.paneMargin + dockingMetrics.paneRadius}px`,
  );
  expect(frame["--pane-seam-color"]).toBe("transparent");
});
it("subtracts occupied rails from native controls on both sides at zoom", () => {
  expect(
    dockingGeometry({
      navigation: "right",
      tabs: "top",
      chromeLeft: 8 / 1.5,
      chromeRight: 140 / 1.5,
    }).titlebarInsets,
  ).toEqual({ animate: true, left: 8 + 8 / 1.5, right: 140 / 1.5 - dockingMetrics.rail });
  expect(
    dockingGeometry({ navigation: "right", tabs: "top", autoHide: true, chromeRight: 140 })
      .titlebarInsets?.right,
  ).toBe(140);
});
it("merges standalone route chrome into the titlebar", () => {
  expect(
    dockingGeometry({ navigation: "left", tabs: "top", shareTopBand: false }).content.gridRow,
  ).toBe("1 / 4");
});

it("reserves native buttons once when top bars stack, then transfers the inset on auto-hide", () => {
  const pinned = dockingGeometry({ navigation: "top", tabs: "top", chromeRight: 140 });
  expect(pinned.navigation.gridRow).toBe(1);
  expect(pinned.content.gridRow).toBe(3);
  expect(pinned.titlebarInsets).toEqual({ animate: true, left: 8, right: 0 });
  const hidden = dockingGeometry({
    navigation: "top",
    tabs: "top",
    autoHide: true,
    chromeRight: 140,
  });
  expect(hidden.content.gridRow).toBe("1 / 4");
  expect(hidden.titlebarInsets).toEqual({ animate: true, left: 92, right: 140 });
});
