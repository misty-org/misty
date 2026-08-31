import { mediaSearchCompleteLegacyAdoption } from "@/features/files/native";
import type { MediaSearchSnapshot } from "@/native/contracts";
import { adoptLegacyMediaSearchDevice } from "./useMediaSearchServerStore";

export async function ensureMediaSearchDeviceReady(
  snapshot: MediaSearchSnapshot,
): Promise<MediaSearchSnapshot> {
  if (!snapshot.legacyAdoptionPending) return snapshot;
  const result = await adoptLegacyMediaSearchDevice(snapshot.deviceId);
  return mediaSearchCompleteLegacyAdoption(result.ready);
}
