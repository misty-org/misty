import type { CSSProperties } from "react";
import type { DockingLayout } from "@/app/shell/dockingLayout";

export const dockingMetrics = {
  titlebar: 38,
  /** Top inset shared by the sidebar and its native window controls: none, it meets the edge. */
  sideTabInset: 0,
  sideTabs: 280,
  /** Between two panels (the sidebar and the page): nothing, a hairline divides them. */
  gap: 0,
  tab: 28,
  /** Between a panel and the window's edge: nothing, panels run to the edge of the window. */
  edge: 0,
  /** The Space bar's own height, below the window edge. */
  spaceBar: 36,
  paneRadius: 0,
};
export const dockingMotion = { duration: 300, easing: "ease-in-out" };
type ShellStyle = CSSProperties & Record<`--${string}`, string | number>;

/**
 * The only owner of shell tracks and pane seams. Tabs always sit in a sidebar inside the
 * content area, so the shell has one titlebar row and the content spans the window.
 */
export function dockingGeometry({
  navigation,
  sideTabsWidth = dockingMetrics.sideTabs,
}: DockingLayout & {
  /** The sidebar's width, which the person can drag. */
  sideTabsWidth?: number;
}) {
  const { titlebar, gap, edge, paneRadius } = dockingMetrics;
  const frame: ShellStyle = {
    gridTemplateColumns: "0px minmax(0, 1fr) 0px",
    gridTemplateRows: `${titlebar}px 0px minmax(0, 1fr) 0px`,
    "--shell-titlebar": `${titlebar}px`,
    "--shell-side-tabs": `${sideTabsWidth}px`,
    "--shell-side-tab-inset": `${dockingMetrics.sideTabInset}px`,
    "--shell-tab-height": `${dockingMetrics.tab}px`,
    "--shell-gap": `${gap}px`,
    "--shell-edge": `${edge}px`,
    "--shell-motion-duration": `${dockingMotion.duration}ms`,
    "--shell-motion-easing": dockingMotion.easing,
  };
  // The page runs to the window's edge on every side; these stay so a margin can come back.
  const seams = {
    top: gap,
    bottom: edge,
    left: navigation === "right" ? gap : edge,
    right: navigation === "right" ? edge : gap,
  };
  frame["--pane-frame"] = `${edge}px`;
  frame["--pane-seam-color"] = "transparent";
  for (const side of ["top", "right", "bottom", "left"] as const)
    frame[`--pane-seam-${side}`] = `${seams[side]}px`;
  // A pane's corner is its margin plus the page's own radius, so the page curve sits inside it.
  for (const y of ["top", "bottom"] as const)
    for (const x of ["left", "right"] as const)
      frame[`--pane-corner-${y}-${x}`] = `${Math.max(seams[y], seams[x]) + paneRadius}px`;
  const content: CSSProperties = { gridColumn: 2, gridRow: "1 / 4" };
  // Native window buttons sit on the left, so the right side reaches the window's top edge.
  const railFlush = navigation === "right";
  return { frame, content, railFlush };
}
