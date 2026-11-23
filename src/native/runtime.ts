import type { AppSnapshot } from "@/native/ipc";

import { invoke } from "./invoke";
export function revealMainWindow(): Promise<void> {
  return invoke("reveal_main_window");
}

export function setWindowSurface(color: string): Promise<void> {
  return invoke("set_window_surface", { color });
}

type TrafficLightOffset = { x: number; y: number };
const sidebarContentLeft = 19;
const trafficLightRestX = 20;
export const trafficLightRestY = 19;
export const sideTabTrafficLightNudgeX = 2;
export const trafficLightOffsetDefault: TrafficLightOffset = {
  x: sidebarContentLeft - trafficLightRestX,
  y: 0,
};
let trafficLightOffset = trafficLightOffsetDefault;
let pendingWindowStyle: Promise<void> | null = null;

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
