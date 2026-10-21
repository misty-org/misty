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
  it("makes the page a rounded pane with an even margin on every edge", () => {
    const { frame } = dockingGeometry(layout);
    for (const edge of ["top", "right", "bottom", "left"] as const)
      expect(frame[`--pane-seam-${edge}`]).toBe(`${dockingMetrics.paneMargin}px`);
    expect(frame["--pane-corner-top-left"]).toBe(
      `${dockingMetrics.paneMargin + dockingMetrics.paneRadius}px`,
    );
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
