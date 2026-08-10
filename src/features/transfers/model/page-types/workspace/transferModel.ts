import type { TransferRecord } from "@/native/contracts";
import type { TransferSortKey } from "../../stores/transfers/types/useTransfersStore";

export type TransferTableColumn =
  "transfer" | "operation" | "status" | "time" | "remote" | "actions";

export type TransferColumnWidths = Record<TransferTableColumn, number>;

export type TransferSortableKey = Exclude<TransferSortKey, "none">;

export type TransferTreeRow = {
  row: TransferRecord;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

export type TransferProgressSnapshot = {
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  aggregated: boolean;
};
