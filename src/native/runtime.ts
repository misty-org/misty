import type { AppSnapshot } from "@/native/ipc";

import { invoke } from "./invoke";
export function revealMainWindow(): Promise<void> {
  return invoke("reveal_main_window");
}

/** Paints the window behind its page in the page's background ("#rrggbb"), which shows at the
 * grown edge while a resize catches up. */
export function setWindowSurface(color: string): Promise<void> {
  return invoke("set_window_surface", { color });
}

/** Where the window buttons sit relative to their usual spot (20pt from the left, 19pt down):
 * the vertical sidebar moves them onto its panel. Every call to the window style carries the
 * current value, so the order the shell and the sidebar mount in never undoes it. */
type TrafficLightOffset = { x: number; y: number };
/** Where the vertical sidebar's content starts, from the window's left edge: the strip's 8pt
 * padding, the panel's 1pt border and its 10pt padding (SidebarDrawer.tsx). The window buttons start
 * here too, so the red one lines up with the address bar. */
const sidebarContentLeft = 19;
const trafficLightRestX = 20;
export const trafficLightRestY = 19;
export const sideTabTrafficLightNudgeX = 2;
/** The native side centers each button's frame on the line it is given, and the circle sits in
 * the middle of its frame: given the icons' line, the circles' centers sit on it, with no extra
 * drop (an earlier 2pt one left them below the sidebar head's icons). */
export const trafficLightOffsetDefault: TrafficLightOffset = {
  x: sidebarContentLeft - trafficLightRestX,
  y: 0,
};
let trafficLightOffset = trafficLightOffsetDefault;
let pendingWindowStyle: Promise<void> | null = null;

/** `offset`, when given, becomes the new position; omitted, the current one is kept. Calls made
 * in one React commit (the shell and the sidebar both place the buttons) go out as one, with the
 * last offset, so the buttons never stop at an earlier caller's spot on the way. */
export function enableModernWindowStyle(
  window: unknown,
  offset?: TrafficLightOffset,
): Promise<void> {
  if (offset) trafficLightOffset = offset;
  pendingWindowStyle ??= Promise.resolve().then(() => {
    pendingWindowStyle = null;
    return invoke("enable_modern_window_style", {
      window,
      offsetX: trafficLightOffset.x,
      offsetY: trafficLightOffset.y,
    });
  });
  return pendingWindowStyle;
}

/** They move with the bar that holds them over `durationMs`: `distance` points sideways with the
 * sidebar, or `rise` points up with the Space bar. They never fade: away, they sit off the window. */
export function setTrafficLightsVisible(
  visible: boolean,
  distance = 0,
  durationMs = 0,
  rise = 0,
): Promise<void> {
  return invoke("set_traffic_lights_visible", { visible, distance, rise, durationMs });
}

export function appSnapshot(): Promise<AppSnapshot> {
  return invoke("app_snapshot");
}
