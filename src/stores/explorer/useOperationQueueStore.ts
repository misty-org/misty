import { create } from "zustand";
import {
  operationQueueCancel,
  operationQueueCancelBatch,
  operationQueueClearTerminal,
  operationQueuePause,
  operationQueuePauseAll,
  operationQueuePauseBatch,
  operationQueueRedo,
  operationQueueResolveConflict,
  operationQueueResume,
  operationQueueResumeAll,
  operationQueueResumeBatch,
  operationQueueRetry,
  operationQueueRetryTransfer,
  operationQueueSetBandwidthLimit,
  operationQueueSetTransferProfile,
  operationQueueSnapshot,
  operationQueueUndo,
} from "@/stores/backend";
import type { OperationConflictPolicy } from "@/models/types/services/misty-api";
import type {
  OperationBatch,
  OperationDescriptor,
  OperationEndpoint,
  OperationQueueSnapshot,
} from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";

let silentOperationQueueLoadInFlight = false;

export const useOperationQueueStore = create<OperationQueueStore>((set) => ({
  snapshot: null,
  working: false,
  error: null,

  load: async (options = {}) => {
    if (options.silent && silentOperationQueueLoadInFlight && !options.force) return;
    if (options.silent) silentOperationQueueLoadInFlight = true;
    if (!options.silent) set({ working: true, error: null });
    try {
      const next = await operationQueueSnapshot();
      set((state) =>
        operationQueueSnapshotsEqual(state.snapshot, next) ? state : { snapshot: next },
      );
    } catch (error) {
      // A silent background poll must not publish its failure: the transfers view
      // reads `error` right after awaiting a user action, so a poll that fails in
      // that window would be reported as the failure of whatever was just clicked.
      if (!options.silent) set({ error: errorText(error) });
    } finally {
      if (options.silent) silentOperationQueueLoadInFlight = false;
      if (!options.silent) set({ working: false });
    }
  },

  cancel: async (operationId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueCancel(operationId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  cancelBatch: async (batchId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueCancelBatch(batchId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  pause: async (operationId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueuePause(operationId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  resume: async (operationId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueResume(operationId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  pauseBatch: async (batchId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueuePauseBatch(batchId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  resumeBatch: async (batchId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueResumeBatch(batchId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  pauseAll: async () => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueuePauseAll() });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  resumeAll: async () => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueResumeAll() });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  setBandwidthLimit: async (limit) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueSetBandwidthLimit(limit) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  setTransferProfile: async (profile) => {
    set({ working: true, error: null });
    try {
      set({
        snapshot: await operationQueueSetTransferProfile(
          profile.id,
          profile.name,
          profile.transfers,
          profile.bandwidthLimit,
        ),
      });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  retry: async (operationId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueRetry(operationId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  retryTransfer: async (transferId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueRetryTransfer(transferId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  undo: async (undoTokenId) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueUndo(undoTokenId) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  redo: async () => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueRedo() });
    } catch (error) {
      set({ error: errorText(error) });
      try {
        set({ snapshot: await operationQueueSnapshot() });
      } catch {
        // Keep the original redo error visible if the follow-up snapshot refresh also fails.
      }
    } finally {
      set({ working: false });
    }
  },

  resolveConflict: async (operationId, policy, applyToBatch) => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueResolveConflict(operationId, policy, applyToBatch) });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },

  clearTerminal: async () => {
    set({ working: true, error: null });
    try {
      set({ snapshot: await operationQueueClearTerminal() });
    } catch (error) {
      set({ error: errorText(error) });
    } finally {
      set({ working: false });
    }
  },
}));

function operationQueueSnapshotsEqual(
  left: OperationQueueSnapshot | null,
  right: OperationQueueSnapshot,
): boolean {
  if (!left) return false;
  return (
    left.activeCount === right.activeCount &&
    left.maxConcurrent === right.maxConcurrent &&
    left.redoAvailable === right.redoAvailable &&
    left.paused === right.paused &&
    left.bandwidthLimit === right.bandwidthLimit &&
    left.transferProfileId === right.transferProfileId &&
    left.transferProfileName === right.transferProfileName &&
    operationConflictDialogsEqual(left.conflictDialog, right.conflictDialog) &&
    arraysEqual(left.operations, right.operations, operationsEqual) &&
    arraysEqual(left.batches, right.batches, batchesEqual)
  );
}

function operationsEqual(left: OperationDescriptor, right: OperationDescriptor): boolean {
  return (
    left.operationId === right.operationId &&
    left.transferId === right.transferId &&
    left.batchId === right.batchId &&
    left.parentTransferId === right.parentTransferId &&
    left.rootTransferId === right.rootTransferId &&
    left.treeDepth === right.treeDepth &&
    left.kind === right.kind &&
    endpointsEqual(left.source, right.source) &&
    endpointsEqual(left.target, right.target) &&
    left.conflictPolicy === right.conflictPolicy &&
    left.status === right.status &&
    left.preserveOrder === right.preserveOrder &&
    left.retryable === right.retryable &&
    left.cancelable === right.cancelable &&
    left.undoable === right.undoable &&
    left.supportsReplace === right.supportsReplace &&
    left.supportsKeepBoth === right.supportsKeepBoth &&
    left.title === right.title &&
    left.errorMessage === right.errorMessage &&
    left.attempt === right.attempt &&
    left.paused === right.paused
  );
}

function endpointsEqual(left: OperationEndpoint, right: OperationEndpoint): boolean {
  return (
    left.localPath === right.localPath &&
    left.remoteName === right.remoteName &&
    left.remotePath === right.remotePath
  );
}

function batchesEqual(left: OperationBatch, right: OperationBatch): boolean {
  return (
    left.batchId === right.batchId &&
    left.label === right.label &&
    left.preserveOrder === right.preserveOrder &&
    left.paused === right.paused &&
    left.pausedOperationId === right.pausedOperationId &&
    arraysEqual(left.operationIds, right.operationIds, Object.is)
  );
}

function operationConflictDialogsEqual(
  left: OperationQueueSnapshot["conflictDialog"],
  right: OperationQueueSnapshot["conflictDialog"],
): boolean {
  return (
    left.open === right.open &&
    left.operationId === right.operationId &&
    left.batchId === right.batchId &&
    left.applyToBatch === right.applyToBatch &&
    left.supportsReplace === right.supportsReplace &&
    left.supportsKeepBoth === right.supportsKeepBoth &&
    left.selectedPolicy === right.selectedPolicy &&
    left.title === right.title &&
    left.sourceLabel === right.sourceLabel &&
    left.targetLabel === right.targetLabel
  );
}

function arraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
  equal: (left: T, right: T) => boolean,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => equal(value, right[index]));
}

export interface OperationQueueStore {
  snapshot: OperationQueueSnapshot | null;
  working: boolean;
  error: string | null;
  load: (options?: { silent?: boolean; force?: boolean }) => Promise<void>;
  cancel: (operationId: number) => Promise<void>;
  cancelBatch: (batchId: number) => Promise<void>;
  pause: (operationId: number) => Promise<void>;
  resume: (operationId: number) => Promise<void>;
  pauseBatch: (batchId: number) => Promise<void>;
  resumeBatch: (batchId: number) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  setBandwidthLimit: (limit: string) => Promise<void>;
  setTransferProfile: (profile: {
    id: string;
    name: string;
    transfers: number;
    bandwidthLimit: string;
  }) => Promise<void>;
  retry: (operationId: number) => Promise<void>;
  retryTransfer: (transferId: number) => Promise<void>;
  undo: (undoTokenId: number) => Promise<void>;
  redo: () => Promise<void>;
  resolveConflict: (
    operationId: number,
    policy: OperationConflictPolicy,
    applyToBatch: boolean,
  ) => Promise<void>;
  clearTerminal: () => Promise<void>;
}
