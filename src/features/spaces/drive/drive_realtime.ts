import { hasTauriInternals } from "@/shared/platform/tauri";
import type { SpaceEvent } from "../api/dto/entities";
import { driveNative } from "./drive_native";

export function forwardDriveRealtimeEvent(event: SpaceEvent) {
  if (!event.type.startsWith("drive.") || !hasTauriInternals()) return;
  void driveNative
    .realtimeEvent(event.space_id, event.type, event.payload ?? {}, event.created_at || undefined)
    .catch(() => undefined);
}
