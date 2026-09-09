import type {
  Space,
  SpaceStorageUsage,
  StorageQuotaDimension,
} from "@/api/spaces/dto/interfaces/types";
import { useEffect, useMemo, useState } from "react";
import { useSpacesStore } from "../../store/useSpacesStore";
import {
  fetchSpaceStorageUsage,
  getCachedSpaceStorageUsage,
  isSpaceStorageUsageStale,
  subscribeUsageCache,
  USAGE_CACHE_TTL_MS,
} from "../../store/usageCache";

/**
 * Storage quota for the active Space, cached and rechecked every 5 minutes
 * or when the Library changes.
 */
export function useSpaceLibraryUsage(options: {
  activeSpaceId: string;
  activeSpace: Space | undefined;
  snapshotReady: boolean;
  enabled?: boolean;
}): SpaceStorageUsage | null {
  const { activeSpaceId, activeSpace, snapshotReady } = options;
  const enabled = options.enabled ?? true;
  const ownerStorage = useSpacesStore((state) => state.ownerStorage);
  const [usage, setUsage] = useState<SpaceStorageUsage | null>(() =>
    getCachedSpaceStorageUsage(activeSpaceId),
  );

  useEffect(() => {
    if (!enabled || !snapshotReady || !activeSpaceId || !activeSpace) {
      return;
    }

    const unsubscribe = subscribeUsageCache(() => {
      setUsage(getCachedSpaceStorageUsage(activeSpaceId));
    });

    if (isSpaceStorageUsageStale(activeSpaceId)) {
      void fetchSpaceStorageUsage(activeSpaceId);
    } else {
      setUsage(getCachedSpaceStorageUsage(activeSpaceId));
    }

    const interval = setInterval(() => {
      void fetchSpaceStorageUsage(activeSpaceId, true);
    }, USAGE_CACHE_TTL_MS);

    const reloadOnLibraryEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id === activeSpaceId) {
        void fetchSpaceStorageUsage(activeSpaceId, true);
      }
    };

    window.addEventListener("misty:space-library-event", reloadOnLibraryEvent);
    return () => {
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener("misty:space-library-event", reloadOnLibraryEvent);
    };
  }, [activeSpace, activeSpaceId, enabled, snapshotReady]);

  return useMemo(() => {
    if (!activeSpaceId || !activeSpace) return null;
    const spaceItem = ownerStorage?.spaces?.find((s) => s.space_id === activeSpaceId);
    if (!spaceItem && !usage && !ownerStorage) return null;

    const personal =
      usage?.personal ??
      storageDimension({
        used: usage?.personal_used_bytes ?? usage?.used_bytes ?? ownerStorage?.used_bytes,
        reserved:
          usage?.personal_reserved_bytes ?? usage?.reserved_bytes ?? ownerStorage?.reserved_bytes,
        limit: usage?.personal_limit_bytes ?? usage?.limit_bytes ?? ownerStorage?.limit_bytes,
        remaining:
          usage?.personal_remaining_bytes ??
          usage?.remaining_bytes ??
          ownerStorage?.remaining_bytes,
        overQuota: usage?.personal_over_quota,
      });
    const space =
      usage?.space ??
      storageDimension({
        used: usage?.space_used_bytes ?? spaceItem?.used_bytes,
        reserved: usage?.space_reserved_bytes ?? spaceItem?.reserved_bytes,
        // On older servers the flat limit represented the owner-plan pool.
        limit: usage?.space_limit_bytes ?? usage?.limit_bytes ?? ownerStorage?.limit_bytes,
        remaining: usage?.space_remaining_bytes ?? usage?.remaining_bytes,
        overQuota: usage?.space_over_quota,
      });

    return {
      ...usage,
      space_id: activeSpaceId,
      personal,
      space,
      storage_available:
        usage?.storage_available ??
        ((personal?.remaining_bytes ?? 1) > 0 && (space?.remaining_bytes ?? 1) > 0),
    };
  }, [activeSpace, activeSpaceId, ownerStorage, usage]);
}

function storageDimension(values: {
  used?: number;
  reserved?: number;
  limit?: number;
  remaining?: number;
  overQuota?: boolean;
}): StorageQuotaDimension | undefined {
  if (values.used === undefined && values.limit === undefined) return undefined;
  const used = values.used ?? 0;
  const reserved = values.reserved ?? 0;
  const limit = values.limit ?? 0;
  return {
    used_bytes: used,
    reserved_bytes: reserved,
    limit_bytes: limit,
    remaining_bytes: values.remaining ?? Math.max(0, limit - used - reserved),
    over_quota: values.overQuota ?? used + reserved > limit,
  };
}
