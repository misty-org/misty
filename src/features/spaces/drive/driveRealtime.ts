import { hasTauriInternals } from "@/shared/platform/tauri";
import type { SpaceEvent } from "../api/dto/entities";
import { driveNative } from "./driveNative";

/**
 * Hands a realtime `drive.*` Space event (`drive.changed`, `drive.in_use_check`, `drive.edit_moved`,
 * `drive.in_use`) to the drive's sync core, which reads the changes or marks it means or answers the
 * check. Anything else is left alone.
 */
export function forwardDriveRealtimeEvent(event: SpaceEvent) {
  if (!event.type.startsWith("drive.") || !hasTauriInternals()) return;
  void driveNative
    .realtimeEvent(event.space_id, event.type, event.payload ?? {}, event.created_at || undefined)
    .catch(() => undefined);
}
