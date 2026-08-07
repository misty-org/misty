import { memo, useEffect, useRef, useState } from "react";
import { useExplorerStore } from "@/stores/explorer";
import { useSetupStore } from "@/stores/app";
import { useTransfersStore } from "@/stores/transfers";
import type { TransferStatus } from "@/models/types/services/misty-api";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { workStatusPopupClass, workStatusPulseClass, workStatusToastDurationMs } from "./styles";
import {
  advanceTransferCompletionTracker,
  emptyTransferCompletionTracker,
} from "../transferCompletionNotifications";

const activeWorkStatuses = new Set<TransferRecord["status"]>(["queued", "pending", "in_progress"]);
const emptyTransferRows: TransferRecord[] = [];

export const WorkStatusPopup = memo(function WorkStatusPopup() {
  const rows = useTransfersStore((state) => state.transfers?.rows ?? emptyTransferRows);
  const loadTransfers = useTransfersStore((state) => state.load);
  const setupInstalling = useSetupStore(
    (state) => state.installState === "installing" || state.busy,
  );
  const [visibleSummary, setVisibleSummary] = useState<{ title: string; detail: string } | null>(
    null,
  );

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      if (!disposed) void loadTransfers(undefined, { silent: true });
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [loadTransfers]);

  const summary = workStatusSummary(rows, setupInstalling);
  const summaryTitle = summary?.title ?? "";
  const summaryDetail = summary?.detail ?? "";

  useEffect(() => {
    if (!summaryTitle) {
      setVisibleSummary(null);
      return;
    }
    setVisibleSummary({ title: summaryTitle, detail: summaryDetail });
    const timeout = window.setTimeout(() => {
      setVisibleSummary(null);
    }, workStatusToastDurationMs);
    return () => window.clearTimeout(timeout);
  }, [summaryTitle, summaryDetail]);

  if (!visibleSummary) return null;

  return (
    <aside className={workStatusPopupClass} role="status" aria-live="polite">
      <span className={workStatusPulseClass} />
      <span className="min-w-0">
        <strong className="block truncate text-[13px] font-semibold leading-tight">
          {visibleSummary.title}
        </strong>
        <span className="block truncate text-xs leading-tight text-cream-muted">
          {visibleSummary.detail}
        </span>
      </span>
    </aside>
  );
});

const transferNotificationStatuses = new Set<TransferStatus>([
  "completed",
  "failed",
  "interrupted",
]);

export const TransferCompletionNotifier = memo(function TransferCompletionNotifier() {
  const transferPage = useTransfersStore((state) => state.transfers);
  const trackerRef = useRef(emptyTransferCompletionTracker());

  useEffect(() => {
    // A null page means the durable transfer history has not loaded yet. Do
    // not treat that temporary empty state as the completion baseline.
    if (!transferPage) return;
    const advanced = advanceTransferCompletionTracker(
      trackerRef.current,
      transferPage.rows,
      transferNotificationStatuses,
    );
    trackerRef.current = advanced.tracker;
    const pushNotification = useExplorerStore.getState().pushNotification;
    for (const row of advanced.changed) {
      if (row.status === "completed") {
        pushNotification(`Transfer finished: ${transferNotificationTitle(row)}`, "success", 4200);
      } else {
        pushNotification(
          `Transfer needs attention: ${transferNotificationTitle(row)}`,
          "error",
          5600,
        );
      }
    }
  }, [transferPage]);

  return null;
});

function transferNotificationTitle(row: TransferRecord): string {
  const title = row.queueTitle.trim() || row.fileName.trim();
  if (title) return title;
  return `${row.transferType} #${row.id}`;
}

function workStatusSummary(
  rows: TransferRecord[],
  installing: boolean,
): { title: string; detail: string } | null {
  const active = rows.filter((row) => activeWorkStatuses.has(row.status));
  const downloads = active.filter((row) => row.transferType === "download").length;
  const uploads = active.filter((row) => row.transferType === "upload").length;

  if (downloads > 0 && uploads > 0) {
    return {
      title: "Transferring...",
      detail: `${downloads} ${downloads === 1 ? "download" : "downloads"}, ${uploads} ${uploads === 1 ? "upload" : "uploads"}`,
    };
  }
  if (downloads > 0) {
    return {
      title: "Downloading...",
      detail: `${downloads} active ${downloads === 1 ? "download" : "downloads"}`,
    };
  }
  if (uploads > 0) {
    return {
      title: "Uploading...",
      detail: `${uploads} active ${uploads === 1 ? "upload" : "uploads"}`,
    };
  }
  if (installing) {
    return {
      title: "Installing...",
      detail: "Setting up Misty components",
    };
  }
  return null;
}
