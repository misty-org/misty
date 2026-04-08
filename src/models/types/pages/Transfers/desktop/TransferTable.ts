import { memo, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { EmptyState } from "@/ui";
import { PrimitiveIconButton as IconButton } from "@/ui";
import { StatusBadge } from "@/ui";
import { Button } from "@/ui";
import { prettyLabel } from "@/lib/format";
import type {
  TransferSortDirection,
  TransferSortKey,
} from "@/models/types/stores/transfers/useTransfersStore";
import { relativeTime, remoteSummary } from "@/pages/Transfers/transferUtils";
import {
  TransferRowActionsMenu,
  TransferRowContextMenu,
} from "@/pages/Transfers/desktop/TransferMenus";
import type { TransferActionHandlers } from "@/models/types/pages/Transfers/desktop/TransferMenus";
import {
  canPauseResumeTransfer,
  isTransferTableColumn,
  primaryTransferLabel,
  secondaryTransferLabel,
  sortIndicator,
  transferColumnLabels,
  transferSortByColumn,
  transferStatusLabel,
  transferStatusTone,
  transferTime,
} from "@/pages/Transfers/desktop/transferModel";
import type {
  TransferColumnWidths,
  TransferSortableKey,
  TransferTableColumn,
  TransferTreeRow,
} from "@/models/types/pages/Transfers/desktop/transferModel";
import { transferStyles } from "@/pages/Transfers/desktop/transferStyles";

export type TransferTableActions = TransferActionHandlers & {
  selectedCount: number;
  hasTransfers: boolean;
  historyWorking: boolean;
  queueWorking: boolean;
  isBatchPaused: (row: TransferRecord) => boolean;
};
