import type {
  AppEnvironmentSnapshot,
  AppSnapshot,
  ClaudeSendRequest,
  ClaudeStatus,
  ClaudeStreamEvent,
  ClipboardPayload,
  ClipboardSnapshot,
  NoteAssetStoreRequest,
  NoteAssetStoreResult,
  PasteItem,
  StorageSnapshot,
} from "@/native/contracts";

import { invoke } from "./invoke";
export function telemetrySetErrorReportingEnabled(enabled: boolean): Promise<void> {
  return invoke("telemetry_set_error_reporting_enabled", { enabled });
}

export function enableModernWindowStyle(window: unknown): Promise<void> {
  return invoke("enable_modern_window_style", { window, offsetX: -6, offsetY: 0 });
}

export function setNativeWallpaperVideo(window: unknown, path: string | null): Promise<boolean> {
  return invoke("set_native_wallpaper_video", { window, path });
}

export function appSnapshot(): Promise<AppSnapshot> {
  return invoke("app_snapshot");
}

export function appEnvironmentSnapshot(): Promise<AppEnvironmentSnapshot> {
  return invoke("app_environment_snapshot");
}

export function storageSnapshot(): Promise<StorageSnapshot> {
  return invoke("storage_snapshot");
}

export function claudeStatus(): Promise<ClaudeStatus> {
  return invoke("claude_status");
}

export function claudeSendMessage(request: ClaudeSendRequest): Promise<ClaudeStatus> {
  return invoke("claude_send_message", { request });
}

export function claudeDrainEvents(): Promise<ClaudeStreamEvent[]> {
  return invoke("claude_drain_events");
}

export function claudeAbort(): Promise<ClaudeStatus> {
  return invoke("claude_abort");
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

export function notesStoreAsset(request: NoteAssetStoreRequest): Promise<NoteAssetStoreResult> {
  return invoke("notes_store_asset", { request });
}
