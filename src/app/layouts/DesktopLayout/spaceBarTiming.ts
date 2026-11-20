import { remCss } from "@misty/ui";
import { dockingMetrics } from "./dockingGeometry";

/** The bar's own height; the page's top margin below it is the gap to the page. */
export const barHeight = dockingMetrics.spaceBar;
/** The slide's length when the window buttons travel with the bar. */
export const slideMs = 150;
export const openHeight = `calc(var(--shell-edge, 0.375rem) + ${remCss(barHeight)})`;
/** With no bar the strip keeps the edge less the page's gap, so the page still sits the window
 * edge below the top. */
export const closedHeight = "calc(var(--shell-edge, 0.375rem) - var(--shell-gap, 0.25rem))";
