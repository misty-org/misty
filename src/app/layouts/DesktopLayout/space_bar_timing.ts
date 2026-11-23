import { remCss } from "@misty/ui";
import { dockingMetrics } from "./docking_geometry";

export const barHeight = dockingMetrics.spaceBar;
export const slideMs = 150;
export const openHeight = `calc(var(--shell-edge, calc(var(--spacing) * 1.5)) + ${remCss(barHeight)})`;
export const closedHeight =
  "calc(var(--shell-edge, calc(var(--spacing) * 1.5)) - var(--shell-gap, var(--spacing)))";
