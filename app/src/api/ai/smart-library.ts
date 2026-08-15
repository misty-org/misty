import { managedAiRequest } from "./managed";

const basePath = "/ai/smart-library";
const folderPath = (folderId: string) => `${basePath}/folders/${encodeURIComponent(folderId)}`;

export const smartLibraryApi = {
  registerFolder: <T>(body: unknown) =>
    managedAiRequest<T>(`${basePath}/folders`, { method: "POST", body: JSON.stringify(body) }),
  submitPreflight: <T>(folderId: string, body: unknown) =>
    post<T>(`${folderPath(folderId)}/preflight`, body),
  createSample: <T>(folderId: string, body: unknown) =>
    post<T>(`${folderPath(folderId)}/sample`, body),
  approveSample: <T>(folderId: string, body: unknown) =>
    post<T>(`${folderPath(folderId)}/sample/approve`, body),
  approveFolder: <T>(folderId: string, body: unknown) =>
    post<T>(`${folderPath(folderId)}/approve`, body),
  progress: <T>(folderId: string) => managedAiRequest<T>(`${folderPath(folderId)}/progress`),
  results: <T>(folderId: string, after: number) =>
    managedAiRequest<T>(`${folderPath(folderId)}/results?after=${after}`),
  updateAssetTags: <T>(folderId: string, assetId: string, tags: string[]) =>
    managedAiRequest<T>(`${folderPath(folderId)}/assets/${encodeURIComponent(assetId)}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    }),
  submitRescan: <T>(folderId: string, body: unknown) =>
    post<T>(`${folderPath(folderId)}/rescan`, body),
  search: <T>(body: unknown) => post<T>(`${basePath}/search`, body),
  planReindex: <T>(body: unknown) => post<T>(`${basePath}/reindex`, body),
  completeReindex: <T>(jobId: string, assets: unknown[]) =>
    post<T>(`${basePath}/reindex/${encodeURIComponent(jobId)}/complete`, { assets }),
  searchFolder: <T>(folderId: string, query: string, limit: number) =>
    post<T>(`${folderPath(folderId)}/search`, { query, limit }),
  removeFolder: (folderId: string) =>
    managedAiRequest(`${folderPath(folderId)}`, { method: "DELETE" }),
};

function post<T>(path: string, body: unknown): Promise<T> {
  return managedAiRequest<T>(path, { method: "POST", body: JSON.stringify(body) });
}
