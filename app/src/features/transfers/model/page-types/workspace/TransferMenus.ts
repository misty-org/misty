import type { TransferRecord } from "@/native/contracts";
import type { ReactNode } from "react";

export type TransferActionHandlers = {
  onPauseResume: (transfer: TransferRecord) => Promise<void>;
  onPauseResumeBatch: (transfer: TransferRecord) => Promise<void>;
  onCancelBatch: (transfer: TransferRecord) => Promise<void>;
  onResolveConflict: (
    transfer: TransferRecord,
    policy: "replace" | "skip" | "keep_both",
    applyToBatch: boolean,
  ) => Promise<void>;
  onCancel: (transfer: TransferRecord) => Promise<void>;
  onRetry: (transfer: TransferRecord) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
  onDeleteRow: (transferId: number) => void;
  onDeleteSelected: () => void;
  onDeleteAll: () => void;
};

export type TransferActionMenuProps = TransferActionHandlers & {
  row: TransferRecord | null;
  batchPaused: boolean;
  selectedCount: number;
  hasTransfers: boolean;
  historyWorking: boolean;
  queueWorking: boolean;
};

export type TransferMenuEntry =
  | { kind: "separator" }
  | {
      kind: "item";
      label: string;
      icon?: ReactNode;
      disabled?: boolean;
      danger?: boolean;
      run: () => void;
    };
