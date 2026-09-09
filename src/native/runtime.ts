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

export function revealMainWindow(): Promise<void> {
  return invoke("reveal_main_window");
}

export function enableModernWindowStyle(window: unknown): Promise<void> {
  return invoke("enable_modern_window_style", { window, offsetX: -4, offsetY: 0 });
}

export function repositionTrafficLights(window: unknown): Promise<void> {
  return invoke("reposition_traffic_lights", { window, offsetX: -4, offsetY: 0 });
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

export function mailCacheRead(accountId: string): Promise<string | null> {
  return invoke("mail_cache_read", { accountId });
}

export function mailCacheWrite(accountId: string, value: string): Promise<void> {
  return invoke("mail_cache_write", { accountId, value });
}

export function mailCacheRemove(accountId: string): Promise<void> {
  return invoke("mail_cache_remove", { accountId });
}

export function appConfigureServer(
  mode: "hosted" | "self_hosted",
  url?: string | null,
  deploymentId?: string | null,
  name?: string | null,
): Promise<void> {
  return invoke("app_configure_server", {
    mode,
    url: url ?? null,
    deploymentId: deploymentId ?? null,
    name: name ?? null,
  });
}

export function selfHostEntitlementStore(token: string): Promise<void> {
  return invoke("self_host_entitlement_store", { token });
}

export function selfHostEntitlementLoad(): Promise<string | null> {
  return invoke("self_host_entitlement_load");
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
