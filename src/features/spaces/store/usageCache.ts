import { spacesApi } from "@/api/spaces/api";
import {
  personalAgentUsage,
  type AgentUsage,
  type BillingUsage,
} from "@/api/spaces/dto/interfaces/agentUsageTypes";
import type { SpaceStorageUsage } from "@/api/spaces/dto/interfaces/types";

export const USAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T | null;
  fetchedAt: number;
  promise?: Promise<T | null>;
}

let billingUsageCache: CacheEntry<BillingUsage> | null = null;
const storageUsageCache = new Map<string, CacheEntry<SpaceStorageUsage>>();

const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

export function subscribeUsageCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedAgentUsage(): AgentUsage | null {
  return personalAgentUsage(billingUsageCache?.data ?? null);
}

export function getCachedBillingUsage(): BillingUsage | null {
  return billingUsageCache?.data ?? null;
}

export function isAgentUsageStale(): boolean {
  if (!billingUsageCache) return true;
  return Date.now() - billingUsageCache.fetchedAt >= USAGE_CACHE_TTL_MS;
}

export async function fetchBillingUsage(force = false): Promise<BillingUsage | null> {
  const now = Date.now();
  if (!force && billingUsageCache && now - billingUsageCache.fetchedAt < USAGE_CACHE_TTL_MS) {
    return billingUsageCache.data;
  }
  if (billingUsageCache?.promise) {
    return billingUsageCache.promise;
  }

  const promise = spacesApi
    .agentUsage()
    .then((result) => {
      billingUsageCache = { data: result, fetchedAt: Date.now() };
      notifyListeners();
      return result;
    })
    .catch(() => {
      if (!billingUsageCache?.data) {
        billingUsageCache = { data: null, fetchedAt: Date.now() };
      }
      notifyListeners();
      return billingUsageCache?.data ?? null;
    });

  if (billingUsageCache) {
    billingUsageCache.promise = promise;
  } else {
    billingUsageCache = { data: null, fetchedAt: 0, promise };
  }

  return promise;
}

export async function fetchAgentUsage(force = false): Promise<AgentUsage | null> {
  return personalAgentUsage(await fetchBillingUsage(force));
}

export function getCachedSpaceStorageUsage(spaceId: string): SpaceStorageUsage | null {
  const entry = storageUsageCache.get(spaceId);
  return entry?.data ?? null;
}

export function isSpaceStorageUsageStale(spaceId: string): boolean {
  const entry = storageUsageCache.get(spaceId);
  if (!entry) return true;
  return Date.now() - entry.fetchedAt >= USAGE_CACHE_TTL_MS;
}

export async function fetchSpaceStorageUsage(
  spaceId: string,
  force = false,
): Promise<SpaceStorageUsage | null> {
  if (!spaceId) return null;
  const now = Date.now();
  const existing = storageUsageCache.get(spaceId);
  if (!force && existing && now - existing.fetchedAt < USAGE_CACHE_TTL_MS) {
    return existing.data;
  }
  if (existing?.promise) {
    return existing.promise;
  }

  const promise = spacesApi
    .libraryUsage(spaceId)
    .then((data) => {
      if (data && (!data.space_id || data.space_id === spaceId)) {
        storageUsageCache.set(spaceId, { data, fetchedAt: Date.now() });
        notifyListeners();
        return data;
      }
      return existing?.data ?? null;
    })
    .catch(() => {
      if (!existing?.data) {
        storageUsageCache.set(spaceId, { data: null, fetchedAt: Date.now() });
      }
      notifyListeners();
      return existing?.data ?? null;
    });

  if (existing) {
    existing.promise = promise;
  } else {
    storageUsageCache.set(spaceId, { data: null, fetchedAt: 0, promise });
  }

  return promise;
}

export function clearUsageCache(): void {
  billingUsageCache = null;
  storageUsageCache.clear();
  notifyListeners();
}
