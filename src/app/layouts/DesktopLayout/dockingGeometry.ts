import type { CSSProperties } from "react";
import type { DockingLayout } from "@/features/app-shell/dockingLayout";

export const dockingMetrics = {
  titlebar: 38,
  /** Top inset shared by the tab sidebar and its native window controls. */
  sideTabInset: 5,
  sideTabs: 280,
  gap: 8,
  tab: 28,
  /** Chrome margin around the page, which is always a rounded pane. */
  paneMargin: 6,
  paneRadius: 12,
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
  /** The tab sidebar's width, which the person can drag. */
  sideTabsWidth?: number;
}) {
  const { titlebar, gap, paneMargin, paneRadius } = dockingMetrics;
  const frame: ShellStyle = {
    gridTemplateColumns: "0px minmax(0, 1fr) 0px",
    gridTemplateRows: `${titlebar}px 0px minmax(0, 1fr) 0px`,
    "--shell-titlebar": `${titlebar}px`,
    "--shell-side-tabs": `${sideTabsWidth}px`,
    "--shell-side-tab-inset": `${dockingMetrics.sideTabInset}px`,
    "--shell-tab-height": `${dockingMetrics.tab}px`,
    "--shell-gap": `${gap}px`,
    "--shell-motion-duration": `${dockingMotion.duration}ms`,
    "--shell-motion-easing": dockingMotion.easing,
  };
  // The page is always a pane: an even margin of window chrome on every edge, with the page's
  // own rounded corners inside it.
  frame["--pane-frame"] = `${paneMargin}px`;
  frame["--pane-seam-color"] = "transparent";
  for (const edge of ["top", "right", "bottom", "left"] as const)
    frame[`--pane-seam-${edge}`] = `${paneMargin}px`;
  // A pane's corner is the margin plus the page's own radius, so the page curve sits inside it.
  for (const y of ["top", "bottom"] as const)
    for (const x of ["left", "right"] as const)
      frame[`--pane-corner-${y}-${x}`] = `${paneMargin + paneRadius}px`;
  const content: CSSProperties = { gridColumn: 2, gridRow: "1 / 4" };
  // Native window buttons sit on the left, so the right side reaches the window's top edge.
  const railFlush = navigation === "right";
  return { frame, content, railFlush };
}
export type DockingGeometry = ReturnType<typeof dockingGeometry>;
