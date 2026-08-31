import { spacesApi } from "@/api/spaces/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUsageCache,
  fetchAgentUsage,
  fetchSpaceStorageUsage,
  getCachedAgentUsage,
  getCachedSpaceStorageUsage,
  isAgentUsageStale,
  isSpaceStorageUsageStale,
  subscribeUsageCache,
  USAGE_CACHE_TTL_MS,
} from "./usageCache";

describe("usageCache", () => {
  beforeEach(() => {
    clearUsageCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearUsageCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("Agent AI Usage", () => {
    it("fetches, caches, and notifies listeners for agent usage", async () => {
      const mockUsage = { percentage_used: 45, available: true, paused: false };
      const spy = vi.spyOn(spacesApi, "agentUsage").mockResolvedValue({
        agent_usage: mockUsage,
      });

      const listener = vi.fn();
      const unsubscribe = subscribeUsageCache(listener);

      expect(getCachedAgentUsage()).toBeNull();
      expect(isAgentUsageStale()).toBe(true);

      const promise = fetchAgentUsage();
      expect(await promise).toEqual(mockUsage);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(getCachedAgentUsage()).toEqual(mockUsage);
      expect(isAgentUsageStale()).toBe(false);
      expect(listener).toHaveBeenCalled();

      // Second call within TTL should return cached value without fetching again
      const cachedResult = await fetchAgentUsage();
      expect(cachedResult).toEqual(mockUsage);
      expect(spy).toHaveBeenCalledTimes(1);

      // After 5 minutes (TTL expires), it should be marked stale
      vi.advanceTimersByTime(USAGE_CACHE_TTL_MS + 1000);
      expect(isAgentUsageStale()).toBe(true);

      // Fetching after TTL triggers a new network request
      await fetchAgentUsage();
      expect(spy).toHaveBeenCalledTimes(2);

      unsubscribe();
    });

    it("forces refetch when force=true even within TTL", async () => {
      const mockUsage = { percentage_used: 10, available: true, paused: false };
      const spy = vi.spyOn(spacesApi, "agentUsage").mockResolvedValue({
        agent_usage: mockUsage,
      });

      await fetchAgentUsage();
      expect(spy).toHaveBeenCalledTimes(1);

      await fetchAgentUsage(true);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe("Space Storage Usage", () => {
    it("fetches, caches per space, and notifies listeners", async () => {
      const mockStorage1 = {
        space_id: "space-1",
        space_used_bytes: 1000,
        used_bytes: 5000,
        limit_bytes: 10000,
        remaining_bytes: 5000,
        storage_available: true,
      };
      const mockStorage2 = {
        space_id: "space-2",
        space_used_bytes: 2000,
        used_bytes: 5000,
        limit_bytes: 10000,
        remaining_bytes: 5000,
        storage_available: true,
      };

      const spy = vi.spyOn(spacesApi, "libraryUsage").mockImplementation(async (id) => {
        if (id === "space-1") return mockStorage1;
        return mockStorage2;
      });

      const listener = vi.fn();
      const unsubscribe = subscribeUsageCache(listener);

      expect(getCachedSpaceStorageUsage("space-1")).toBeNull();
      expect(isSpaceStorageUsageStale("space-1")).toBe(true);

      await fetchSpaceStorageUsage("space-1");
      expect(spy).toHaveBeenCalledWith("space-1");
      expect(getCachedSpaceStorageUsage("space-1")).toEqual(mockStorage1);
      expect(isSpaceStorageUsageStale("space-1")).toBe(false);

      await fetchSpaceStorageUsage("space-2");
      expect(spy).toHaveBeenCalledWith("space-2");
      expect(getCachedSpaceStorageUsage("space-2")).toEqual(mockStorage2);

      // Querying space-1 again returns cached version without calling API again
      await fetchSpaceStorageUsage("space-1");
      expect(spy).toHaveBeenCalledTimes(2);

      // Fast forward 5 minutes
      vi.advanceTimersByTime(USAGE_CACHE_TTL_MS + 1000);
      expect(isSpaceStorageUsageStale("space-1")).toBe(true);

      await fetchSpaceStorageUsage("space-1");
      expect(spy).toHaveBeenCalledTimes(3);

      unsubscribe();
    });
  });
});
