import { spacesApi } from "@/api/spaces/api";
import type { AgentUsage } from "@/api/spaces/dto/interfaces/agentUsageTypes";
import type { SpaceStorageUsage } from "@/api/spaces/dto/interfaces/types";

export const USAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T | null;
  fetchedAt: number;
  promise?: Promise<T | null>;
}

let agentUsageCache: CacheEntry<AgentUsage> | null = null;
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
  return agentUsageCache?.data ?? null;
}

export function isAgentUsageStale(): boolean {
  if (!agentUsageCache) return true;
  return Date.now() - agentUsageCache.fetchedAt >= USAGE_CACHE_TTL_MS;
}

export async function fetchAgentUsage(force = false): Promise<AgentUsage | null> {
  const now = Date.now();
  if (!force && agentUsageCache && now - agentUsageCache.fetchedAt < USAGE_CACHE_TTL_MS) {
    return agentUsageCache.data;
  }
  if (agentUsageCache?.promise) {
    return agentUsageCache.promise;
  }

  const promise = spacesApi
    .agentUsage()
    .then((result) => {
      const data = result.agent_usage ?? null;
      agentUsageCache = { data, fetchedAt: Date.now() };
      notifyListeners();
      return data;
    })
    .catch(() => {
      if (!agentUsageCache?.data) {
        agentUsageCache = { data: null, fetchedAt: Date.now() };
      }
      notifyListeners();
      return agentUsageCache?.data ?? null;
    });

  if (agentUsageCache) {
    agentUsageCache.promise = promise;
  } else {
    agentUsageCache = { data: null, fetchedAt: 0, promise };
  }

  return promise;
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
  agentUsageCache = null;
  storageUsageCache.clear();
  notifyListeners();
}
