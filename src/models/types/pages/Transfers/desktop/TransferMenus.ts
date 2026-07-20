import type { ReactElement, ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { PrimitiveIconButton as IconButton } from "@/ui";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import type {
  TransferSortDirection,
  TransferSortKey,
} from "@/models/types/stores/transfers/useTransfersStore";
import {
  canPauseResumeTransfer,
  transferSortOptions,
} from "@/pages/Transfers/desktop/transferModel";
import type { TransferSortableKey } from "@/models/types/pages/Transfers/desktop/transferModel";
import { transferStyles } from "@/pages/Transfers/desktop/transferStyles";

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
