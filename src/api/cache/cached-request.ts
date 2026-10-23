import { apiRequest } from "@/api/client";
import { readApiAccountId, readApiSessionGeneration } from "@/api/client/session";
import { readApiCache, writeApiCache } from "./api-cache";

export interface CachedRequestOptions<T> {
  /**
   * Called first, with the saved copy, when there is one. Paint it; the fresh response follows.
   * It is not called when nothing is saved, so the screen shows its skeleton only on a first
   * load.
   */
  onCached?: (value: T, fetchedAt: number) => void;
  init?: RequestInit;
}

/**
 * A GET that answers twice: at once from the saved copy (`onCached`), then from the server.
 * The returned promise is the fresh response, so callers keep their existing error handling;
 * a failed refresh leaves whatever `onCached` painted on screen. The response is saved for
 * the next visit. Requests always bypass the web view's own HTTP cache, since the saved copy
 * is the fast path and the server reply must be the real one.
 */
export async function cachedRequest<T>(
  path: string,
  options: CachedRequestOptions<T> = {},
): Promise<T> {
  const account = readApiAccountId();
  const generation = readApiSessionGeneration();
  if (account && options.onCached) {
    const hit = await readApiCache(account, path);
    if (hit && generation === readApiSessionGeneration()) {
      try {
        options.onCached(JSON.parse(hit.body) as T, hit.fetchedAt);
      } catch {
        /* a copy that cannot be read is a miss */
      }
    }
  }
  const fresh = await apiRequest<T>(path, { ...options.init, cache: "no-store" });
  if (account && generation === readApiSessionGeneration() && readApiAccountId() === account)
    void writeApiCache(account, path, JSON.stringify(fresh ?? null));
  return fresh;
}
