import type { OperationQueueSnapshot } from "@/services/misty/model/misty-api";
import type { OperationConflictPolicy } from "@/services/misty/model/types/misty-api";

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
