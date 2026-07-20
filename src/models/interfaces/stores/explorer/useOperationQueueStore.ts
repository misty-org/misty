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
