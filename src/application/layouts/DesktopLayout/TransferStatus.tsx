import { useActivityStore } from "@/features/activity/useActivityStore";
import { useSetupStore } from "@/features/installer";
import { useTransfersStore } from "@/features/transfers/store/useTransfersStore";
import type { TransferRecord } from "@/native/contracts";
import type { TransferStatus } from "@/native/contracts/primitives";
import { isWebBuild } from "@/shared/platform/buildTarget";
import { memo, useEffect, useRef, useState } from "react";
import {
  advanceTransferCompletionTracker,
  emptyTransferCompletionTracker,
} from "../transferCompletionNotifications";
import { workStatusToastDurationMs } from "./styles";
import { Notification } from "@/shared/ui/notification";

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
    if (isWebBuild) return;
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
    <Notification
      key={`${visibleSummary.title}:${visibleSummary.detail}`}
      title={visibleSummary.title}
    >
      {visibleSummary.detail}
    </Notification>
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
    const pushNotification = (title: string, level: string, _duration: number) => {
      useActivityStore
        .getState()
        .ingestLocal({
          title,
          kind: level === "success" ? "completion" : "failure",
          appId: "files",
        });
    };
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
