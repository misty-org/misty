import type { TransferRecord } from "@/services/misty/model/misty-api";
import type { TransferStatus } from "@/services/misty/model/types/misty-api";

export interface TransferCompletionTracker {
  ready: boolean;
  statuses: Record<number, TransferStatus>;
}

export interface TransferCompletionAdvance {
  tracker: TransferCompletionTracker;
  changed: TransferRecord[];
}
