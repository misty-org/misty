import { managedAiRequest } from "@/features/agents";
import type { MediaChunkIndexResponse, MediaSearchResponse } from "@/features/files/explorer";
import type { PreparedMediaChunk } from "@/native/contracts";
export type {
  MediaChunkIndexResponse,
  MediaSearchHit,
  MediaSearchResponse,
} from "@/features/files/explorer";

const basePath = "/ai/media-search";
export function indexMediaChunk(chunk: PreparedMediaChunk): Promise<MediaChunkIndexResponse> {
  return managedAiRequest(`${basePath}/chunks`, { method: "POST", body: JSON.stringify(chunk) });
}
export function searchMedia(
  deviceId: string,
  query: string,
  limit = 20,
): Promise<MediaSearchResponse> {
  return managedAiRequest(basePath + "/search", {
    method: "POST",
    body: JSON.stringify({ deviceId, query, limit }),
  });
}
export function fetchMediaSearchStatus(deviceId: string): Promise<{
  assets: Array<{
    deviceId: string;
    assetId: string;
    fingerprint: string;
    status: string;
    durationMs: number;
    indexedThroughMs: number;
  }>;
  maxDurationMinutes: number;
  totalDurationLimitMinutes: null;
}> {
  return managedAiRequest(basePath + "/status?deviceId=" + encodeURIComponent(deviceId));
}
export function deleteMediaSearchAsset(
  deviceId: string,
  assetId: string,
): Promise<{ deleted: boolean }> {
  return managedAiRequest(
    basePath +
      "/assets/" +
      encodeURIComponent(assetId) +
      "?deviceId=" +
      encodeURIComponent(deviceId),
    { method: "DELETE" },
  );
}
export function deleteMediaSearchDevice(deviceId: string): Promise<{ deleted: boolean }> {
  return managedAiRequest(basePath + "/devices/" + encodeURIComponent(deviceId), {
    method: "DELETE",
  });
}
export function adoptLegacyMediaSearchDevice(
  deviceId: string,
): Promise<{ ready: boolean; adopted: boolean }> {
  return managedAiRequest(basePath + "/devices/" + encodeURIComponent(deviceId) + "/adopt-legacy", {
    method: "POST",
  });
}
