import { unreadActivityCountForTool, useActivityStore } from "@/features/activity";
import { usePersonalAgentsStore } from "@/features/agents";
import { useSearchStore } from "@/features/files/search";
import { useTransfersStore } from "@/features/transfers";
import type { TransferRecord } from "@/native/contracts";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect, useMemo } from "react";

const activeTransferStatuses = new Set<TransferRecord["status"]>([
  "queued",
  "pending",
  "in_progress",
  "waiting_for_resolution",
]);

export interface HomeStatus {
  transfers: { active: number; failed: number; transferredBytes: number; totalBytes: number };
  agents: { total: number; unread: number };
  index: { scanning: boolean; itemCount: number; lastScanTimeMs: number | null };
}

/**
 * Live signals Misty already tracks but never surfaced together.
 *
 * Transfers are loaded here because nothing else does it outside the Transfers
 * tool, so the counts would otherwise read zero on a fresh launch.
 */
export function useHomeStatus(): HomeStatus {
  const rows = useTransfersStore((state) => state.transfers?.rows);
  const loadTransfers = useTransfersStore((state) => state.load);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const activityItems = useActivityStore((state) => state.allItems);
  const searchStatus = useSearchStore((state) => state.status);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    void loadTransfers("", { silent: true }).catch(() => undefined);
  }, [loadTransfers]);

  return useMemo(() => {
    const transferRows = rows ?? [];
    const active = transferRows.filter((row) => activeTransferStatuses.has(row.status));
    return {
      transfers: {
        active: active.length,
        failed: transferRows.filter((row) => row.status === "failed").length,
        transferredBytes: active.reduce((total, row) => total + row.transferredBytes, 0),
        totalBytes: active.reduce((total, row) => total + row.totalBytes, 0),
      },
      // Per-agent run state needs a request per Agent, so the live signal here
      // is the unread agent activity the store already aggregates.
      agents: {
        total: agents.length,
        unread: unreadActivityCountForTool(activityItems, "agents"),
      },
      index: {
        scanning: searchStatus?.scanInProgress ?? false,
        itemCount: searchStatus?.indexedItemCount ?? 0,
        lastScanTimeMs: searchStatus?.lastScanTimeMs ?? null,
      },
    };
  }, [activityItems, agents, rows, searchStatus]);
}
