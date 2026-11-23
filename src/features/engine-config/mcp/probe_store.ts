// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { mcpApi } from "./api";
import { confirmWorkspaceProbe, confirmedFingerprint, forgetProbeConfirm } from "./probe_confirm";
import { copy } from "./copy";
import type { McpConfigEntry, McpProbeState } from "./types";

export const PROBE_TTL_MS = 3 * 60_000;
export const PROBE_CONCURRENCY = 4;

interface McpProbeStore {
  results: Record<string, McpProbeState>;
  pending: Record<string, true>;
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

export function probeStateFor(
  results: Record<string, McpProbeState>,
  entry: McpConfigEntry,
): McpProbeState | null {
  const state = results[entry.id];
  if (!state || state.version !== entry.version) return null;
  return state;
}

export function probeable(entry: McpConfigEntry): boolean {
  return Boolean(entry.command || entry.url);
}

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
  const run = async (entry: McpConfigEntry, workspace: string | null): Promise<void> => {
    set((state) => ({ pending: { ...state.pending, [entry.id]: true }, error: null }));
    try {
      const result = entry.workspaceFile
        ? await mcpApi.probe(entry, workspace, confirmedFingerprint(entry, workspace))
        : await mcpApi.probe(entry, workspace);
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
        const fromWorkspace = targets.filter((entry) => entry.workspaceFile);
        if (fromWorkspace.length > 0 && !(await confirmWorkspaceProbe(fromWorkspace, workspace))) {
          targets = targets.filter((entry) => !entry.workspaceFile);
        }
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

export function autoProbeEligible(entries: McpConfigEntry[]): McpConfigEntry[] {
  return entries.filter((entry) => entry.enabled && probeable(entry) && !entry.workspaceFile);
}

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
