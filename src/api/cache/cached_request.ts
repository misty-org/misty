import { apiRequest } from "@/api/client";
import { readApiAccountId, readApiSessionGeneration } from "@/api/client/session";
import { readApiCache, writeApiCache } from "./api_cache";

interface CachedRequestOptions<T> {
  onCached?: (value: T, fetchedAt: number) => void;
  init?: RequestInit;
}

export async function cachedRequest<T>(
  path: string,
  options: CachedRequestOptions<T> = {},
): Promise<T> {
  const account = readApiAccountId();
  const generation = readApiSessionGeneration();
  const request = apiRequest<T>(path, { ...options.init, cache: "no-store" });
  request.catch(() => {});
  if (account && options.onCached) {
    const hit = await readApiCache(account, path);
    if (hit && generation === readApiSessionGeneration()) {
      try {
        options.onCached(JSON.parse(hit.body) as T, hit.fetchedAt);
      } catch {}
    }
  }
  const fresh = await request;
  if (account && generation === readApiSessionGeneration() && readApiAccountId() === account)
    void writeApiCache(account, path, JSON.stringify(fresh ?? null));
  return fresh;
}
