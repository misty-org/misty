import { describe, expect, it } from "vitest";
import { dockingGeometry, dockingMetrics } from "./dockingGeometry";
import { tabSides } from "@/features/app-shell/dockingLayout";

describe.each(tabSides)("tabs on the %s", (tabs) => {
  const layout = { tabs, navigation: tabs === "left" ? ("right" as const) : ("left" as const) };
  it("keeps one titlebar row and lets the content span the window", () => {
    const geometry = dockingGeometry(layout);
    expect(geometry.content).toEqual({ gridColumn: 2, gridRow: "1 / 4" });
    expect(geometry.frame.gridTemplateColumns).toBe("0px minmax(0, 1fr) 0px");
    expect(geometry.frame.gridTemplateRows).toBe(
      `${dockingMetrics.titlebar}px 0px minmax(0, 1fr) 0px`,
    );
  });
  it("keeps the window edge on the page's outer sides and the gap toward the sidebar", () => {
    const { frame } = dockingGeometry(layout);
    const { gap, edge, paneRadius } = dockingMetrics;
    const seams = { top: gap, bottom: edge, [tabs]: gap, [layout.navigation]: edge };
    for (const side of ["top", "right", "bottom", "left"] as const)
      expect(frame[`--pane-seam-${side}`]).toBe(`${seams[side]}px`);
    expect(frame[`--pane-corner-bottom-${tabs}`]).toBe(`${edge + paneRadius}px`);
    expect(frame["--pane-seam-color"]).toBe("transparent");
  });
});

it("sizes the tab sidebar from the dragged width", () => {
  expect(
    dockingGeometry({ navigation: "right", tabs: "left", sideTabsWidth: 320 }).frame[
      "--shell-side-tabs"
    ],
  ).toBe("320px");
});
