import type { CSSProperties } from "react";
import type { DockingLayout } from "@/app/shell/docking_layout";
import { remCss } from "@misty/ui";

export const dockingMetrics = {
  titlebar: 38,
  sideTabInset: 0,
  sideTabs: 280,
  gap: 6,
  tab: 28,
  edge: 6,
  spaceBar: 36,
  paneRadius: 12,
};
export const dockingMotion = { duration: 300, easing: "ease-in-out" };
type ShellStyle = CSSProperties & Record<`--${string}`, string | number>;

export function dockingGeometry({
  navigation,
  sideTabsWidth = dockingMetrics.sideTabs,
}: DockingLayout & {
  sideTabsWidth?: number;
}) {
  const { titlebar, gap, edge, paneRadius } = dockingMetrics;
  const frame: ShellStyle = {
    gridTemplateColumns: "0px minmax(0, 1fr) 0px",
    gridTemplateRows: `${remCss(titlebar)} 0px minmax(0, 1fr) 0px`,
    "--shell-titlebar": remCss(titlebar),
    "--shell-side-tabs": remCss(sideTabsWidth),
    "--shell-side-tab-inset": remCss(dockingMetrics.sideTabInset),
    "--shell-tab-height": remCss(dockingMetrics.tab),
    "--shell-gap": remCss(gap),
    "--shell-edge": remCss(edge),
    "--shell-motion-duration": `${dockingMotion.duration}ms`,
    "--shell-motion-easing": dockingMotion.easing,
  };
  const seams = {
    top: gap,
    bottom: edge,
    left: navigation === "right" ? gap : edge,
    right: navigation === "right" ? edge : gap,
  };
  frame["--pane-frame"] = remCss(edge);
  frame["--pane-seam-color"] = "transparent";
  frame["--pane-radius"] = remCss(paneRadius);
  frame["--pane-edge"] = "var(--color-charcoal-border)";
  for (const side of ["top", "right", "bottom", "left"] as const)
    frame[`--pane-seam-${side}`] = remCss(seams[side]);
  for (const y of ["top", "bottom"] as const)
    for (const x of ["left", "right"] as const)
      frame[`--pane-corner-${y}-${x}`] = remCss(Math.max(seams[y], seams[x]) + paneRadius);
  const content: CSSProperties = { gridColumn: 2, gridRow: "1 / 4" };
  const railFlush = navigation === "right";
  return { frame, content, railFlush };
}

export function withWindowChrome(frame: CSSProperties, chrome: string): ShellStyle {
  return { ...frame, "--misty-window-chrome": chrome };
}
