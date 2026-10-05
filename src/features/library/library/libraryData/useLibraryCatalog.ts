import { libraryApi as spacesApi } from "../LibraryRuntime";
import type { SpaceStorageUsage } from "@/api/spaces/dto/entities";
import { useCallback, useEffect, useState } from "react";

/**
 * Everything about the Library *except* the current item list: its storage use.
 *
 * Loads on mount and whenever `reloadKey` changes; `refreshCatalog` exposes the
 * same load as an awaitable call.
 */
export function useLibraryCatalog(options: {
  spaceId: string;
  reloadKey: number;
  setLocalError: (message: string) => void;
}) {
  const { spaceId, reloadKey, setLocalError } = options;
  const [usage, setUsage] = useState<SpaceStorageUsage | null>(null);

  const refreshCatalog = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const currentUsage = await spacesApi.libraryUsage(spaceId);
      if (!isCancelled()) setUsage(currentUsage);
    },
    [spaceId],
  );

  useEffect(() => {
    let current = true;
    void refreshCatalog(() => !current).catch(
      (error: unknown) =>
        current &&
        setLocalError(error instanceof Error ? error.message : "Library could not be loaded."),
    );
    return () => {
      current = false;
    };
  }, [refreshCatalog, reloadKey, setLocalError]);

  return { refreshCatalog, usage, setUsage };
}
