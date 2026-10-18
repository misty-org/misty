import type { CSSProperties } from "react";
import {
  isSideDock,
  type DockingLayout,
} from "@/features/app-shell/dockingLayout";

export const dockingMetrics = {
  titlebar: 38,
  /** The tab strip: the window's 8px top margin, then the 36px tabs. */
  tabStrip: 44,
  /** Gap above a horizontal strip's tabs: the same 8px margin the page keeps on its other edges. */
  tabInset: 8,
  /** How far a connected tab's curve flares out past its sides; mirrors `--tab-shoulder`. */
  tabShoulder: 12,
  /** Clear space between the window buttons and where the first tab's curve starts. */
  tabLead: 8,
  /** Top inset shared by vertical tabs and their native window controls. */
  sideTabInset: 5,
  /** The retired navigation rail: its tracks stay at zero, but the layout model still names them. */
  rail: 62,
  horizontalRail: 44,
  sideTabs: 280,
  gap: 8,
  tab: 28,
  /** Chrome margin around the page, which is always a rounded pane. */
  paneMargin: 8,
  paneRadius: 12,
};
export const dockingMotion = { duration: 300, easing: "ease-in-out" };
type ShellStyle = CSSProperties & Record<`--${string}`, string | number>;

/** The only owner of shell tracks, native chrome insets and pane seams. */
export function dockingGeometry({
  navigation: position,
  tabs,
  autoHide = false,
  shareTopBand = tabs === "top",
  chromeLeft = 84,
  chromeRight = 0,
  sideTabsWidth = dockingMetrics.sideTabs,
}: DockingLayout & {
  autoHide?: boolean;
  shareTopBand?: boolean;
  /** Already adjusted for application zoom. */
  chromeLeft?: number;
  chromeRight?: number;
  /** The vertical tab sidebar's width, which the person can drag. */
  sideTabsWidth?: number;
}) {
  const { rail, gap } = dockingMetrics;
  const titlebar =
    tabs === "top" && shareTopBand ? dockingMetrics.tabStrip : dockingMetrics.titlebar;
  const side = isSideDock(position);
  const thickness = side ? rail : dockingMetrics.horizontalRail;
  const size = autoHide ? 0 : thickness;
  const topTabs = shareTopBand && tabs === "top";
  const shared = topTabs && !(position === "top" && !autoHide);
  const frame: ShellStyle = {
    // Keep the same track topology on every edge, including auto-hide.
    gridTemplateColumns: `${position === "left" ? size : 0}px minmax(0, 1fr) ${position === "right" ? size : 0}px`,
    gridTemplateRows: `${position === "top" ? size : titlebar}px 0px minmax(0, 1fr) ${position === "bottom" ? size : 0}px`,
    "--shell-titlebar": `${titlebar}px`,
    "--shell-side-tabs": `${sideTabsWidth}px`,
    "--shell-tab-strip-height": `${dockingMetrics.tabStrip}px`,
    "--shell-tab-inset": `${dockingMetrics.tabInset}px`,
    "--shell-side-tab-inset": `${dockingMetrics.sideTabInset}px`,
    "--shell-tab-height": `${dockingMetrics.tab}px`,
    "--shell-gap": `${gap}px`,
    "--shell-motion-duration": `${dockingMotion.duration}ms`,
    "--shell-motion-easing": dockingMotion.easing,
  };
  // The page is always a pane: an even margin of window chrome on every edge, with the page's
  // own rounded corners inside it. The one edge a horizontal tab strip sits on has no margin:
  // the strip's connected tabs hang from the page's outline there, which is a 1px seam.
  const attached = tabs === "top" || tabs === "bottom" ? tabs : null;
  const { paneMargin, paneRadius } = dockingMetrics;
  frame["--pane-frame"] = `${paneMargin}px`;
  frame["--pane-seam-color"] = "transparent";
  for (const edge of ["top", "right", "bottom", "left"] as const)
    frame[`--pane-seam-${edge}`] = edge === attached ? "1px" : `${paneMargin}px`;
  // A pane's corner is the margin plus the page's own radius, so the page curve sits inside it.
  for (const y of ["top", "bottom"] as const)
    for (const x of ["left", "right"] as const)
      frame[`--pane-corner-${y}-${x}`] =
        y === attached ? `${paneRadius}px` : `${paneMargin + paneRadius}px`;
  // Native window buttons sit on the left (or the right on Windows), so a right rail with
  // nothing above it reaches the window's top edge.
  const railFlush = side && position === "right" && chromeRight === 0;
  const navigation: CSSProperties = {
    gridColumn: side ? (position === "right" ? 3 : 1) : "1 / -1",
    gridRow: side ? (railFlush ? "1 / -1" : "2 / -1") : position === "bottom" ? 4 : 1,
    ...(side ? { width: rail } : { height: thickness }),
  };
  const content: CSSProperties = {
    gridColumn: 2,
    gridRow: position === "top" && !autoHide ? 3 : "1 / 4",
  };
  const floating: CSSProperties = side
    ? { top: railFlush ? 0 : titlebar, bottom: 0, width: rail, [position]: 0 }
    : { left: 0, right: 0, height: thickness, [position]: 0 };
  const reveal: CSSProperties = side ? { ...floating, width: 8 } : { ...floating, height: 8 };
  const translate = {
    left: "translateX(-100%)",
    right: "translateX(100%)",
    top: "translateY(-100%)",
    bottom: "translateY(100%)",
  }[position];
  const titlebarInsets = topTabs
    ? {
        animate: true,
        left: shared ? Math.max(gap, chromeLeft + gap - (position === "left" ? size : 0)) : gap,
        right: shared ? Math.max(0, chromeRight - (position === "right" ? size : 0)) : 0,
      }
    : undefined;
  return { frame, navigation, content, floating, reveal, translate, titlebarInsets, railFlush };
}
export type DockingGeometry = ReturnType<typeof dockingGeometry>;
