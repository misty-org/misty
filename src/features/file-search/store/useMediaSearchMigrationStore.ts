import { mediaSearchCompleteLegacyAdoption } from "@/services/backend";
import type { MediaSearchSnapshot } from "@/services/misty/model/misty-api";
import { adoptLegacyMediaSearchDevice } from "./useMediaSearchServerStore";

export async function ensureMediaSearchDeviceReady(
  snapshot: MediaSearchSnapshot,
): Promise<MediaSearchSnapshot> {
  if (!snapshot.legacyAdoptionPending) return snapshot;
  const result = await adoptLegacyMediaSearchDevice(snapshot.deviceId);
  return mediaSearchCompleteLegacyAdoption(result.ready);
}
