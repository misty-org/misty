// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * MCP check results, in memory only, for the settings block.
 *
 * Apart from `useMcpInventory`'s runtime section: that is what a CLI session reported itself,
 * while this is a check **Misty ran**. The rules:
 *
 * - **Check on open**: when the panel or tab appears it runs once, but only for entries in the
 *   person's own config that are on, checkable and have no fresh result (`useAutoProbe` /
 *   `autoProbeEligible`), so opening again just reuses the cache;
 * - **Folder config asks first**: entries whose config file is in the folder (`workspaceFile`,
 *   possibly from a repository) are never checked on their own, and a manual check shows the
 *   full command through `probe-confirm.ts` first;
 * - **Cache**: results are kept by entry id plus config hash, so a changed config drops its old
 *   result at once; within `PROBE_TTL_MS` an automatic check reuses the result, and only
 *   Check all forces a new run;
 * - **Limited parallelism**: at most `PROBE_CONCURRENCY` checks at a time (starting stdio is I/O
 *   waiting, so one by one is too slow, and all at once starts a pile of npx), and a failure
 *   affects only its own entry.
 */
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { mcpApi } from "./api";
import { confirmWorkspaceProbe, confirmedFingerprint, forgetProbeConfirm } from "./probe-confirm";
import { copy } from "./copy";
import type { McpConfigEntry, McpProbeState } from "./types";

/** How long an automatic check reuses a result before checking again. */
export const PROBE_TTL_MS = 3 * 60_000;
/** The most checks running at once. */
export const PROBE_CONCURRENCY = 4;

interface McpProbeStore {
  /** Entry id → result; entries in `pending` are being checked. */
  results: Record<string, McpProbeState>;
  pending: Record<string, true>;
  /** Whether Check all is running (its queue included). */
  runningAll: boolean;
  error: string | null;
  probe: (entry: McpConfigEntry, workspace: string | null) => Promise<void>;
  probeAll: (
    entries: McpConfigEntry[],
    workspace: string | null,
    options?: { force?: boolean },
  ) => Promise<void>;
  clear: () => void;
}

/** A result counts only for the config version it ran on. */
export function probeStateFor(
  results: Record<string, McpProbeState>,
  entry: McpConfigEntry,
): McpProbeState | null {
  const state = results[entry.id];
  if (!state || state.version !== entry.version) return null;
  return state;
}

/** Checkable when the config really has a command or an address. */
export function probeable(entry: McpConfigEntry): boolean {
  return Boolean(entry.command || entry.url);
}

/** Whether to check (again): entries that are off, have no command or address, or have a fresh result are skipped. */
export function needsProbe(
  entry: McpConfigEntry,
  results: Record<string, McpProbeState>,
  now = Date.now(),
): boolean {
  if (!entry.enabled || !probeable(entry)) return false;
  const state = probeStateFor(results, entry);
  if (!state) return true;
  return now - state.checkedAt > PROBE_TTL_MS;
}

export const useMcpProbeStore = create<McpProbeStore>((set, get) => {
  /** One probe, no confirmation: callers have already cleared workspace
   *  entries through `confirmWorkspaceProbe`. */
  const run = async (entry: McpConfigEntry, workspace: string | null): Promise<void> => {
    set((state) => ({ pending: { ...state.pending, [entry.id]: true }, error: null }));
    try {
      // Workspace servers carry the fingerprint of the plan the user
      // confirmed; the backend refuses anything else.
      const result = entry.workspaceFile
        ? await mcpApi.probe(entry, workspace, confirmedFingerprint(entry, workspace))
        : await mcpApi.probe(entry, workspace);
      // A response missing fields can't be stored as connected, or one bad response breaks the
      // whole list (counts rely on `toolCount`, which would show as NaN).
      if (!result || typeof result.status !== "string" || typeof result.toolCount !== "number") {
        throw new Error(copy.unrecognizedProbe);
      }
      set((state) => ({
        results: {
          ...state.results,
          [entry.id]: { result, checkedAt: Date.now(), version: entry.version },
        },
      }));
    } catch (probeError) {
      // The file changed after it was confirmed: forget that answer so the
      // next click shows the new command.
      if (entry.workspaceFile && (probeError as { code?: unknown })?.code === "conflict") {
        forgetProbeConfirm(entry, workspace);
      }
      set({
        error: probeError instanceof Error ? probeError.message : String(probeError),
      });
    } finally {
      set((state) => {
        const pending = { ...state.pending };
        delete pending[entry.id];
        return { pending };
      });
    }
  };

  return {
    results: {},
    pending: {},
    runningAll: false,
    error: null,

    probe: async (entry, workspace) => {
      if (!probeable(entry)) return;
      if (entry.workspaceFile && !(await confirmWorkspaceProbe([entry], workspace))) return;
      await run(entry, workspace);
    },

    probeAll: async (entries, workspace, options) => {
      const force = options?.force ?? false;
      let targets = entries.filter((entry) =>
        force ? entry.enabled && probeable(entry) : needsProbe(entry, get().results),
      );
      if (targets.length === 0 || get().runningAll) return;
      set({ runningAll: true, error: null });
      try {
        // Folder servers: one confirmation for all of them; declining
        // still checks the person's own servers.
        const fromWorkspace = targets.filter((entry) => entry.workspaceFile);
        if (fromWorkspace.length > 0 && !(await confirmWorkspaceProbe(fromWorkspace, workspace))) {
          targets = targets.filter((entry) => !entry.workspaceFile);
        }
        // Limited parallelism: each worker takes the next task until the queue is empty.
        const queue = [...targets];
        const worker = async (): Promise<void> => {
          const next = queue.shift();
          if (!next) return;
          await run(next, workspace);
          await worker();
        };
        await Promise.all(
          Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker),
        );
      } finally {
        set({ runningAll: false });
      }
    },

    clear: () => set({ results: {}, error: null }),
  };
});

/**
 * Entries checked on their own when the page opens: on, checkable and in the person's own file.
 * Folder config (`workspaceFile`) may come with a repository and a check really runs its commands,
 * so it never runs on its own; it can still be checked by hand.
 */
export function autoProbeEligible(entries: McpConfigEntry[]): McpConfigEntry[] {
  return entries.filter((entry) => entry.enabled && probeable(entry) && !entry.workspaceFile);
}

/**
 * Checks the `autoProbeEligible` entries on open (or on switching engine). The fingerprint is
 * those entries' id plus config hash: an unchanged fingerprint doesn't run again (opening again
 * only uses the cache), and a changed one fills in only entries without a fresh result.
 */
export function useAutoProbe(
  entries: McpConfigEntry[] | undefined,
  workspacePath: string | null,
  enabled = true,
): void {
  const probeAll = useMcpProbeStore((state) => state.probeAll);
  const runningAll = useMcpProbeStore((state) => state.runningAll);
  const eligible = useMemo(() => autoProbeEligible(entries ?? []), [entries]);
  const fingerprint = useMemo(
    () => eligible.map((entry) => `${entry.id}@${entry.version}`).join("|"),
    [eligible],
  );
  const probed = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || runningAll) return;
    if (probed.current === fingerprint) return;
    probed.current = fingerprint;
    void probeAll(eligible, workspacePath);
  }, [enabled, fingerprint, runningAll, eligible, probeAll, workspacePath]);
}

/** The latest check time among the shown entries (for "checked at …"). */
export function latestCheckedAt(
  entries: McpConfigEntry[],
  results: Record<string, McpProbeState>,
): number | null {
  let latest: number | null = null;
  for (const entry of entries) {
    const state = probeStateFor(results, entry);
    if (!state) continue;
    latest = latest === null ? state.checkedAt : Math.max(latest, state.checkedAt);
  }
  return latest;
}
