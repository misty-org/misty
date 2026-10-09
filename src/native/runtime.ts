import type { AppSnapshot, ClipboardPayload, ClipboardSnapshot, PasteItem } from "@/native/ipc";

import { invoke } from "./invoke";
export function telemetrySetErrorReportingEnabled(enabled: boolean): Promise<void> {
  return invoke("telemetry_set_error_reporting_enabled", { enabled });
}

export function revealMainWindow(): Promise<void> {
  return invoke("reveal_main_window");
}

export function enableModernWindowStyle(window: unknown): Promise<void> {
  return invoke("enable_modern_window_style", { window, offsetX: -4, offsetY: 0 });
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
