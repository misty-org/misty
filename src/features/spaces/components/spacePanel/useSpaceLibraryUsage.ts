import type { Space, SpaceStorageUsage } from "@/api/spaces/dto/interfaces/types";
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

    // The usage endpoint exposes both the owner's pooled totals (`used_bytes`)
    // and the selected Space's contribution (`space_used_bytes`). Feeding the
    // pooled field to the Space footer makes every Space appear identical.
    const usedBytes = usage?.space_used_bytes ?? spaceItem?.used_bytes ?? 0;
    const reservedBytes = usage?.space_reserved_bytes ?? spaceItem?.reserved_bytes ?? 0;
    const limitBytes = usage?.limit_bytes ?? ownerStorage?.limit_bytes;
    const remainingBytes = usage?.remaining_bytes ?? ownerStorage?.remaining_bytes;

    return {
      space_id: activeSpaceId,
      used_bytes: usedBytes,
      reserved_bytes: reservedBytes,
      limit_bytes: limitBytes,
      remaining_bytes: remainingBytes,
      storage_available:
        usage?.storage_available ?? (remainingBytes !== undefined ? remainingBytes > 0 : true),
    };
  }, [activeSpace, activeSpaceId, ownerStorage, usage]);
}
