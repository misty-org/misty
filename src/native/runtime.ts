import type { AppSnapshot, ClipboardPayload, ClipboardSnapshot, PasteItem } from "@/native/ipc";

import { invoke } from "./invoke";
export function telemetrySetErrorReportingEnabled(enabled: boolean): Promise<void> {
  return invoke("telemetry_set_error_reporting_enabled", { enabled });
}

export function revealMainWindow(): Promise<void> {
  return invoke("reveal_main_window");
}

/** Where the window buttons sit relative to their usual spot (20pt from the left, 19pt down):
 * the vertical sidebar moves them onto its panel. Every call to the window style carries the
 * current value, so the order the shell and the sidebar mount in never undoes it. */
export type TrafficLightOffset = { x: number; y: number };
/** Where the vertical sidebar's content starts, from the window's left edge: the strip's 8pt
 * padding, the panel's 1pt border and its 10pt padding (docking.css). The window buttons start
 * here too, so the red one lines up with the address bar. */
export const sidebarContentLeft = 19;
const trafficLightRestX = 20;
export const trafficLightOffsetDefault: TrafficLightOffset = {
  x: sidebarContentLeft - trafficLightRestX,
  y: 0,
};
let trafficLightOffset = trafficLightOffsetDefault;

/** `offset`, when given, becomes the new position; omitted, the current one is kept. */
export function enableModernWindowStyle(
  window: unknown,
  offset?: TrafficLightOffset,
): Promise<void> {
  if (offset) trafficLightOffset = offset;
  return invoke("enable_modern_window_style", {
    window,
    offsetX: trafficLightOffset.x,
    offsetY: trafficLightOffset.y,
  });
}

/** They slide `distance` points and fade over `durationMs`, as the sidebar beside them does. */
export function setTrafficLightsVisible(
  visible: boolean,
  distance = 0,
  durationMs = 0,
): Promise<void> {
  return invoke("set_traffic_lights_visible", { visible, distance, durationMs });
}

export function appSnapshot(): Promise<AppSnapshot> {
  return invoke("app_snapshot");
}

export function clipboardSnapshot(): Promise<ClipboardSnapshot> {
  return invoke("clipboard_snapshot");
}

export function clipboardSetLocal(payload: ClipboardPayload): Promise<ClipboardPayload> {
  return invoke("clipboard_set_local", { payload });
}

export function clipboardPublishShared(): Promise<boolean> {
  return invoke("clipboard_publish_shared");
}

export function clipboardPublishImageBytes(request: {
  bytes: number[];
  width: number;
  height: number;
  mimeType?: string;
}): Promise<boolean> {
  return invoke("clipboard_publish_image_bytes", request);
}

export function clipboardApplyShared(): Promise<ClipboardPayload> {
  return invoke("clipboard_apply_shared");
}

export function clipboardSharedImageBytes(blobId: string): Promise<number[]> {
  return invoke("clipboard_shared_image_bytes", { blobId });
}

export function clipboardNativeFileRefs(): Promise<PasteItem[]> {
  return invoke("clipboard_native_file_refs");
}

export function clipboardWriteFileRefs(items: PasteItem[]): Promise<boolean> {
  return invoke("clipboard_write_file_refs", { items });
}

export function clipboardWriteFileBytes(
  items: Array<{ name: string; bytes: number[] }>,
): Promise<boolean> {
  return invoke("clipboard_write_file_bytes", { items });
}
