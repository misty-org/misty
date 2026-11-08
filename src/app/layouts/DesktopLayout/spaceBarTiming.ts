import { dockingMetrics } from "./dockingGeometry";

/** How long the bar waits after the pointer leaves before it tucks away again. */
export const hideDelay = 500;
/** How long the pointer rests on the top edge before the bar comes out, so a pointer passing
 * over the edge on its way out of the window does not push the page down and back. */
export const revealDelay = 80;
/** The strip along the top edge that brings the bar out. */
export const edgeZone = 6;
/** The bar's own height; the page's top margin below it is the gap to the page. */
export const barHeight = dockingMetrics.spaceBar;
/** The slide's length. The page below keeps its full size and moves its top edge with it. */
export const slideMs = 150;
export const openHeight = `calc(var(--shell-edge, 6px) + ${barHeight}px)`;
/** Tucked away it keeps the edge less the page's gap, so the page still sits the window edge
 * below the top. */
export const closedHeight = "calc(var(--shell-edge, 6px) - var(--shell-gap, 4px))";
