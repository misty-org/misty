import { useEffect, useMemo, useState } from "react";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { Space, SpaceStorageUsage } from "@/models/interfaces/features/spaces/types";

/**
 * Storage quota for the active Space, refreshed whenever the Library changes.
 *
 * `enabled` exists because the quota now lives behind the header's usage
 * popover: there is no reason to poll a number nobody is looking at, so the
 * fetch waits until something actually displays it.
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
  const [usage, setUsage] = useState<SpaceStorageUsage | null>(null);

  useEffect(() => {
    setUsage(null);
    if (!enabled || !snapshotReady || !activeSpaceId || !activeSpace) {
      return;
    }
    let active = true;
    const loadUsage = () => {
      void spacesApi
        .libraryUsage(activeSpaceId)
        .then((next) => {
          if (active && (!next.space_id || next.space_id === activeSpaceId)) setUsage(next);
        })
        .catch(() => {
          if (active) setUsage(null);
        });
    };
    const reloadOnLibraryEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ space_id?: string }>).detail;
      if (detail?.space_id === activeSpaceId) loadUsage();
    };
    loadUsage();
    window.addEventListener("misty:space-library-event", reloadOnLibraryEvent);
    return () => {
      active = false;
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
