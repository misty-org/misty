import { mediaSearchCompleteLegacyAdoption } from "@/stores/backend";
import type { MediaSearchSnapshot } from "@/models/interfaces/services/misty-api";
import { adoptLegacyMediaSearchDevice } from "@/stores/media/useMediaSearchServerStore";

export async function ensureMediaSearchDeviceReady(
  snapshot: MediaSearchSnapshot,
): Promise<MediaSearchSnapshot> {
  if (!snapshot.legacyAdoptionPending) return snapshot;
  const result = await adoptLegacyMediaSearchDevice(snapshot.deviceId);
  return mediaSearchCompleteLegacyAdoption(result.ready);
}
