import { useMemo } from "react";
import { ListFilter, PanelRight } from "lucide-react";
import type { TransferType } from "@/models/types/services/misty-api";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { EmptyState } from "@/ui";
import { StatusBadge } from "@/ui";
import { Button } from "@/ui";
import { Checkbox } from "@/ui";
import { Progress } from "@/ui";
import { RadioGroup, RadioGroupItem } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { prettyLabel } from "@/lib/format";
import type {
  TransferSortDirection,
  TransferSortKey,
} from "@/models/types/stores/transfers/useTransfersStore";
import { transferTypes } from "@/stores/transfers";
import { remoteSummary } from "@/pages/Transfers/transferUtils";
import type { TransferActionHandlers } from "@/models/types/pages/Transfers/desktop/TransferMenus";
import {
  aggregateTransferProgress,
  binaryProgressStatus,
  canPauseResumeTransfer,
  formatBytes,
  isBinaryProgressTransfer,
  primaryTransferLabel,
  sourceEndpoint,
  targetEndpoint,
  timestampLabel,
  transferStatusTone,
} from "@/pages/Transfers/desktop/transferModel";
import type { TransferProgressSnapshot } from "@/models/types/pages/Transfers/desktop/transferModel";
import { transferStyles } from "@/pages/Transfers/desktop/transferStyles";

export type DetailHandlers = Pick<
  TransferActionHandlers,
  | "onCancel"
  | "onRetry"
  | "onPauseResume"
  | "onPauseResumeBatch"
  | "onCancelBatch"
  | "onResolveConflict"
>;
