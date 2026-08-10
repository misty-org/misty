import type { TransferRecord } from "@/services/misty/model/misty-api";
import type { TransferActionHandlers } from "./TransferMenus";

export type TransferTableActions = TransferActionHandlers & {
  selectedCount: number;
  hasTransfers: boolean;
  historyWorking: boolean;
  queueWorking: boolean;
  isBatchPaused: (row: TransferRecord) => boolean;
  isTransferPaused: (row: TransferRecord) => boolean;
};
