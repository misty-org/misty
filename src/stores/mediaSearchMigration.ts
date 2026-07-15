import { mediaSearchCompleteLegacyAdoption } from "../api/misty";
import type { MediaSearchSnapshot } from "../api/types";
import { adoptLegacyMediaSearchDevice } from "./mediaSearchServerApi";

export async function ensureMediaSearchDeviceReady(snapshot: MediaSearchSnapshot): Promise<MediaSearchSnapshot> {
  if (!snapshot.legacyAdoptionPending) return snapshot;
  const result = await adoptLegacyMediaSearchDevice(snapshot.deviceId);
  return mediaSearchCompleteLegacyAdoption(result.ready);
}
