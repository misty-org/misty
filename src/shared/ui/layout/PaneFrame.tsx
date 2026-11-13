import type { HTMLAttributes, Ref } from "react";
import { cn } from "../classNames";
import "./paneFrame.css";

// Each corner is a quarter circle cut out of a square of chrome, `--pane-corner-*` wide, and the
// margin is each edge's own inset shadow: the edge a tab strip hangs from keeps just its seam, so
// the toolbar there is not painted over. The seam line follows the rounded corners.
const paneFrameClass = cn(
  "misty-pane-frame relative isolate overflow-clip",
  "[--pane-chrome:var(--misty-window-chrome,var(--misty-theme-workspace))]",
  "pt-[var(--pane-seam-top)] pr-[var(--pane-seam-right)]",
  "pb-[var(--pane-seam-bottom)] pl-[var(--pane-seam-left)]",
);

export interface PaneFrameProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

/**
 * A pane set into the window's chrome, for the window's tab panels. It keeps a margin of chrome
 * around what it holds, `--pane-seam-top/right/bottom/left` wide (the shell's geometry writes
 * them, and today they are 0), rounds the corners into the chrome (`--pane-corner-*`) and draws
 * the seam line (`--pane-seam-color`), all above whatever is inside (`--layer-pane-corners`,
 * `--layer-pane-seams`), so native pages and toolbars stay within the curve. The pane itself
 * stays transparent, since a native page may show through it: only the margin and the corners
 * are painted, in `--misty-window-chrome`. A hidden pane that keeps its layout (`data-tab-kept`)
 * draws neither.
 */
export function PaneFrame({ className, ref, ...props }: PaneFrameProps) {
  return (
    <div ref={ref} data-slot="pane-frame" className={cn(paneFrameClass, className)} {...props} />
  );
}
