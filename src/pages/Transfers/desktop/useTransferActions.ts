import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TransferRecord } from "../../../api/types";
import { errorText } from "../../../shared/format";
import { useOperationQueueStore } from "../../../stores/useOperationQueueStore";
import { useTransfersStore } from "../../../stores/useTransfersStore";
import { isLiveTransfer } from "./transferModel";

export type TransferActionFeedback = {
  tone: "busy" | "success" | "error";
  text: string;
} | null;

export function useTransferActions(options: { workspaceId: string; rows: TransferRecord[] }) {
  const loadTransfers = useTransfersStore((state) => state.load);
  const deleteIds = useTransfersStore((state) => state.deleteIds);
  const deleteSelected = useTransfersStore((state) => state.deleteSelected);
  const deleteAll = useTransfersStore((state) => state.deleteAll);
  const loadQueue = useOperationQueueStore((state) => state.load);
  const queueSnapshot = useOperationQueueStore((state) => state.snapshot);
  const queueWorking = useOperationQueueStore((state) => state.working);
  const cancelOperation = useOperationQueueStore((state) => state.cancel);
  const cancelBatch = useOperationQueueStore((state) => state.cancelBatch);
  const pauseOperation = useOperationQueueStore((state) => state.pause);
  const resumeOperation = useOperationQueueStore((state) => state.resume);
  const pauseBatch = useOperationQueueStore((state) => state.pauseBatch);
  const resumeBatch = useOperationQueueStore((state) => state.resumeBatch);
  const retryOperation = useOperationQueueStore((state) => state.retry);
  const retryTransfer = useOperationQueueStore((state) => state.retryTransfer);
  const resolveConflict = useOperationQueueStore((state) => state.resolveConflict);
  const undoOperation = useOperationQueueStore((state) => state.undo);
  const feedbackTimerRef = useRef<number | null>(null);
  const [actionFeedback, setActionFeedback] = useState<TransferActionFeedback>(null);

  const refreshTransferViews = useCallback(async (options: { force?: boolean } = {}) => {
    await Promise.all([
      loadTransfers(undefined, { silent: true, force: options.force }),
      useOperationQueueStore.getState().load({ silent: true, force: options.force }),
    ]);
  }, [loadTransfers]);

  const hasLiveTransferWork = useMemo(
    () => options.rows.some(isLiveTransfer) || (queueSnapshot?.activeCount ?? 0) > 0,
    [options.rows, queueSnapshot?.activeCount],
  );
  useEffect(() => {
    const intervalMs = hasLiveTransferWork ? 1000 : 5000;
    const interval = window.setInterval(() => {
      if (!document.hidden) void refreshTransferViews();
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [hasLiveTransferWork, refreshTransferViews]);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
  }, []);

  const showActionFeedback = useCallback((feedback: TransferActionFeedback, autoClearMs = 2800) => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
    setActionFeedback(feedback);
    if (feedback && feedback.tone !== "busy" && autoClearMs > 0) {
      feedbackTimerRef.current = window.setTimeout(() => {
        setActionFeedback(null);
        feedbackTimerRef.current = null;
      }, autoClearMs);
    }
  }, []);

  const refreshAfterQueueMutation = useCallback(async (
    action: Promise<void>,
    labels: { busy: string; success: string },
  ) => {
    showActionFeedback({ tone: "busy", text: labels.busy }, 0);
    try {
      await action;
      const queueError = useOperationQueueStore.getState().error;
      await refreshTransferViews({ force: true });
      if (queueError) showActionFeedback({ tone: "error", text: queueError }, 6500);
      else showActionFeedback({ tone: "success", text: labels.success });
    } catch (error) {
      await refreshTransferViews({ force: true });
      showActionFeedback({ tone: "error", text: errorText(error) }, 6500);
    }
  }, [refreshTransferViews, showActionFeedback]);

  const handleUndo = useCallback((undoTokenId: number) => {
    void refreshAfterQueueMutation(undoOperation(undoTokenId), { busy: "Undoing transfer…", success: "Undo queued." });
  }, [refreshAfterQueueMutation, undoOperation]);
  const handleCancelOperation = useCallback((operationId: number) => refreshAfterQueueMutation(cancelOperation(operationId), {
    busy: "Canceling transfer…",
    success: "Cancel requested.",
  }), [cancelOperation, refreshAfterQueueMutation]);
  const handleRetryOperation = useCallback((operationId: number) => refreshAfterQueueMutation(retryOperation(operationId), {
    busy: "Retrying transfer…",
    success: "Retry queued.",
  }), [refreshAfterQueueMutation, retryOperation]);
  const handlePauseResumeTransfer = useCallback((transfer: TransferRecord) => {
    if (!transfer.operationId) return Promise.resolve();
    const resuming = transfer.paused;
    return refreshAfterQueueMutation(resuming ? resumeOperation(transfer.operationId) : pauseOperation(transfer.operationId), {
      busy: resuming ? "Resuming transfer…" : "Pausing transfer…",
      success: resuming ? "Transfer resumed." : "Pause requested.",
    });
  }, [pauseOperation, refreshAfterQueueMutation, resumeOperation]);
  const handlePauseResumeBatchTransfer = useCallback((transfer: TransferRecord) => {
    if (!transfer.batchId) return Promise.resolve();
    const batch = queueSnapshot?.batches.find((candidate) => candidate.batchId === transfer.batchId);
    const resuming = Boolean(batch?.paused);
    return refreshAfterQueueMutation(resuming ? resumeBatch(transfer.batchId) : pauseBatch(transfer.batchId), {
      busy: resuming ? "Resuming batch…" : "Pausing batch…",
      success: resuming ? "Batch resumed." : "Batch paused.",
    });
  }, [pauseBatch, queueSnapshot?.batches, refreshAfterQueueMutation, resumeBatch]);
  const handleCancelBatchTransfer = useCallback((transfer: TransferRecord) => {
    if (!transfer.batchId) return Promise.resolve();
    return refreshAfterQueueMutation(cancelBatch(transfer.batchId), { busy: "Canceling batch…", success: "Batch cancellation requested." });
  }, [cancelBatch, refreshAfterQueueMutation]);
  const handleResolveConflictTransfer = useCallback((
    transfer: TransferRecord,
    policy: "replace" | "skip" | "keep_both",
    applyToBatch: boolean,
  ) => {
    if (!transfer.operationId) return Promise.resolve();
    return refreshAfterQueueMutation(resolveConflict(transfer.operationId, policy, applyToBatch), {
      busy: "Resolving conflict…",
      success: "Conflict resolved.",
    });
  }, [refreshAfterQueueMutation, resolveConflict]);
  const handleCancelTransfer = useCallback((transfer: TransferRecord) => {
    if (!transfer.operationId) return Promise.resolve();
    return handleCancelOperation(transfer.operationId);
  }, [handleCancelOperation]);
  const handleRetryTransfer = useCallback((transfer: TransferRecord) => {
    if (transfer.operationId) return handleRetryOperation(transfer.operationId);
    return refreshAfterQueueMutation(retryTransfer(transfer.id), { busy: "Retrying transfer…", success: "Retry queued." });
  }, [handleRetryOperation, refreshAfterQueueMutation, retryTransfer]);
  const handleDeleteTransfer = useCallback((transferId: number) => {
    void deleteIds(options.workspaceId, [transferId]);
  }, [deleteIds, options.workspaceId]);
  const handleDeleteSelected = useCallback(() => void deleteSelected(options.workspaceId), [deleteSelected, options.workspaceId]);
  const handleDeleteAll = useCallback(() => void deleteAll(), [deleteAll]);
  const isBatchPaused = useCallback((row: TransferRecord) => Boolean(
    row.batchId && queueSnapshot?.batches.find((batch) => batch.batchId === row.batchId)?.paused,
  ), [queueSnapshot?.batches]);

  return {
    actionFeedback,
    handleCancelBatchTransfer,
    handleCancelTransfer,
    handleDeleteAll,
    handleDeleteSelected,
    handleDeleteTransfer,
    handlePauseResumeBatchTransfer,
    handlePauseResumeTransfer,
    handleResolveConflictTransfer,
    handleRetryTransfer,
    handleUndo,
    isBatchPaused,
    loadQueue,
    loadTransfers,
    queueWorking,
  };
}
