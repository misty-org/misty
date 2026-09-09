import { mediaSearchApi } from "@/api/ai/media-search";
import type { MediaChunkIndexResponse, MediaSearchResponse } from "@/features/files/explorer";
import type { PreparedMediaChunk } from "@/native/contracts";
export type {
  MediaChunkIndexResponse,
  MediaSearchHit,
  MediaSearchResponse,
} from "@/features/files/explorer";

export function indexMediaChunk(chunk: PreparedMediaChunk): Promise<MediaChunkIndexResponse> {
  return mediaSearchApi.indexChunk(chunk);
}
export function searchMedia(
  deviceId: string,
  query: string,
  limit = 20,
): Promise<MediaSearchResponse> {
  return mediaSearchApi.search(deviceId, query, limit);
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
  return mediaSearchApi.status(deviceId);
}
export function deleteMediaSearchAsset(
  deviceId: string,
  assetId: string,
): Promise<{ deleted: boolean }> {
  return mediaSearchApi.removeAsset(deviceId, assetId);
}
export function deleteMediaSearchDevice(deviceId: string): Promise<{ deleted: boolean }> {
  return mediaSearchApi.removeDevice(deviceId);
}
export function adoptLegacyMediaSearchDevice(
  deviceId: string,
): Promise<{ ready: boolean; adopted: boolean }> {
  return mediaSearchApi.adoptLegacyDevice(deviceId);
}
