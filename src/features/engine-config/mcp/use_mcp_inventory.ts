// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useCallback, useEffect, useRef, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { mcpApi, McpHubError } from "./api";
import type { McpConfigEntry, McpInventory } from "./types";

export const mcpInventoryKey = (workspacePath: string | null) =>
  `engine-config/mcp:${workspacePath ?? ""}`;

interface McpInventoryStore {
  inventory: McpInventory | null;
  loading: boolean;
  error: McpHubError | string | null;
  reload: () => Promise<void>;
  setEnabled: (entry: McpConfigEntry, enabled: boolean) => Promise<void>;
  pendingId: string | null;
}

const asHubError = (error: unknown): McpHubError | string =>
  error instanceof McpHubError ? error : String(error);

export function useMcpInventory(workspacePath: string | null): McpInventoryStore {
  const resource = useCachedResource<McpInventory | null>(mcpInventoryKey(workspacePath), () =>
    mcpApi.inventory(workspacePath),
  );
  const [writeError, setWriteError] = useState<McpHubError | string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { reload: reloadResource } = resource;
  const reload = useCallback(async () => {
    setWriteError(null);
    await reloadResource();
  }, [reloadResource]);

  const write = useCallback(
    async (entry: McpConfigEntry, apply: () => Promise<unknown>) => {
      setPendingId(entry.id);
      setWriteError(null);
      try {
        await apply();
        await reloadResource();
      } catch (error) {
        if (mounted.current) setWriteError(asHubError(error));
        throw error;
      } finally {
        if (mounted.current) setPendingId(null);
      }
    },
    [reloadResource],
  );
  const setEnabled = useCallback(
    (entry: McpConfigEntry, enabled: boolean) =>
      write(entry, () => mcpApi.setEnabled(entry, enabled, workspacePath)),
    [write, workspacePath],
  );

  const loadError = resource.error ? asHubError(resource.error) : null;
  return {
    inventory: resource.data ?? null,
    loading: resource.loading,
    error: writeError ?? loadError,
    reload,
    setEnabled,
    pendingId,
  };
}
