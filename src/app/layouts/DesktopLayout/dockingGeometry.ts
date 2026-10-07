import type { CSSProperties } from "react";
import {
  isSideDock,
  type DockPosition,
  type DockingLayout,
} from "@/features/app-shell/dockingLayout";
import { navigatorRailWidth } from "./navigatorMode";

export const dockingMetrics = {
  titlebar: 38,
  tabStrip: 38,
  /** Gap between a horizontal tab strip's outer edge and its connected tabs. */
  tabInset: 3,
  rail: navigatorRailWidth,
  horizontalRail: 38,
  sideTabs: 200,
  gap: 8,
  tab: 28,
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
}: DockingLayout & {
  autoHide?: boolean;
  shareTopBand?: boolean;
  /** Already adjusted for application zoom. */
  chromeLeft?: number;
  chromeRight?: number;
}) {
  const { rail, gap } = dockingMetrics;
  const titlebar =
    tabs === "top" && shareTopBand ? dockingMetrics.tabStrip : dockingMetrics.titlebar;
  const side = isSideDock(position);
  const thickness = side ? rail : dockingMetrics.horizontalRail;
  const size = autoHide ? 0 : thickness;
  const topTabs = shareTopBand && tabs === "top";
  const shared = topTabs && !(position === "top" && !autoHide);
  const edges = new Set<DockPosition>([tabs, ...(!autoHide ? [position] : [])]);
  const frame: ShellStyle = {
    // Keep the same track topology on every edge, including auto-hide.
    gridTemplateColumns: `${position === "left" ? size : 0}px minmax(0, 1fr) ${position === "right" ? size : 0}px`,
    gridTemplateRows: `${position === "top" ? size : titlebar}px 0px minmax(0, 1fr) ${position === "bottom" ? size : 0}px`,
    "--shell-titlebar": `${titlebar}px`,
    "--shell-side-tabs": `${dockingMetrics.sideTabs}px`,
    "--shell-tab-strip-height": `${dockingMetrics.tabStrip}px`,
    "--shell-tab-inset": `${dockingMetrics.tabInset}px`,
    "--shell-tab-height": `${dockingMetrics.tab}px`,
    "--shell-gap": `${gap}px`,
    "--shell-motion-duration": `${dockingMotion.duration}ms`,
    "--shell-motion-easing": dockingMotion.easing,
  };
  for (const edge of ["top", "right", "bottom", "left"] as const)
    frame[`--pane-seam-${edge}`] = edges.has(edge) ? "1px" : "0px";
  for (const y of ["top", "bottom"] as const)
    for (const x of ["left", "right"] as const)
      frame[`--pane-corner-${y}-${x}`] = edges.has(y) && edges.has(x) ? "12px" : "0px";
  const navigation: CSSProperties = {
    gridColumn: side ? (position === "right" ? 3 : 1) : "1 / -1",
    gridRow: side ? "2 / -1" : position === "bottom" ? 4 : 1,
    ...(side ? { width: rail } : { height: thickness }),
  };
  const content: CSSProperties = {
    gridColumn: 2,
    gridRow: position === "top" && !autoHide ? 3 : "1 / 4",
  };
  const floating: CSSProperties = side
    ? { top: titlebar, bottom: 0, width: rail, [position]: 0 }
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
  return { frame, navigation, content, floating, reveal, translate, titlebarInsets };
}
export type DockingGeometry = ReturnType<typeof dockingGeometry>;
