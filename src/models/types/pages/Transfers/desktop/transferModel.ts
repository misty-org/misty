import type { TransferType } from "@/models/types/services/misty-api";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { prettyLabel } from "@/lib/format";
import { transferStatusMatchesFilter } from "@/stores/transfers";
import type {
  TransferSortDirection,
  TransferSortKey,
} from "@/models/types/stores/transfers/useTransfersStore";

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
