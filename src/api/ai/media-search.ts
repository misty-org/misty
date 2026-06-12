import { managedAiRequest } from "./managed";

const basePath = "/ai/media-search";

export const mediaSearchApi = {
  indexChunk: <T>(chunk: unknown) =>
    managedAiRequest<T>(`${basePath}/chunks`, {
      method: "POST",
      body: JSON.stringify(chunk),
    }),
  search: <T>(deviceId: string, query: string, limit: number) =>
    managedAiRequest<T>(`${basePath}/search`, {
      method: "POST",
      body: JSON.stringify({ deviceId, query, limit }),
    }),
  status: <T>(deviceId: string) =>
    managedAiRequest<T>(`${basePath}/status?deviceId=${encodeURIComponent(deviceId)}`),
  removeAsset: <T>(deviceId: string, assetId: string) =>
    managedAiRequest<T>(
      `${basePath}/assets/${encodeURIComponent(assetId)}?deviceId=${encodeURIComponent(deviceId)}`,
      { method: "DELETE" },
    ),
  removeDevice: <T>(deviceId: string) =>
    managedAiRequest<T>(`${basePath}/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    }),
  adoptLegacyDevice: <T>(deviceId: string) =>
    managedAiRequest<T>(`${basePath}/devices/${encodeURIComponent(deviceId)}/adopt-legacy`, {
      method: "POST",
    }),
};
