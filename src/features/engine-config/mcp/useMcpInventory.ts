// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * MCP inventory store: loads config and runtime for every engine, keyed on the
 * chosen folder (project sources and runtime state are workspace-scoped;
 * user sources are not, but come in the same payload).
 *
 * The last inventory for a folder is kept for the session, so coming back to the page shows it
 * at once and reads the files again behind it. It stays in memory only: a server's address or
 * command line can carry a token the redaction doesn't know about, so it is never written to
 * the cache on disk. Each folder has its own entry, so a late answer for one folder never
 * lands on another.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { mcpApi, McpHubError } from "./api";
import type { McpConfigEntry, McpInventory } from "./types";

/** The cache entry for one folder's inventory (none: user sources only). */
export const mcpInventoryKey = (workspacePath: string | null) =>
  `engine-config/mcp:${workspacePath ?? ""}`;

interface McpInventoryStore {
  inventory: McpInventory | null;
  /** Nothing to show yet and the first read is under way. */
  loading: boolean;
  error: McpHubError | string | null;
  reload: () => Promise<void>;
  /** Toggle one entry; reloads config after the write so the UI reflects the
   *  file, not the optimistic click. */
  setEnabled: (entry: McpConfigEntry, enabled: boolean) => Promise<void>;
  /** Entry id currently being written (only that row is disabled). */
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
        // Re-read: the write path merges with the live file, so the response
        // entry alone is not the whole truth after a partial external edit.
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
