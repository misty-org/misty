import { spacesApi } from "@/api/spaces/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUsageCache,
  fetchSpaceStorageUsage,
  getCachedSpaceStorageUsage,
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
