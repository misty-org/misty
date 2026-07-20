import type { TransferStatus } from "@/models/types/services/misty-api";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";

export interface TransferCompletionTracker {
  ready: boolean;
  statuses: Record<number, TransferStatus>;
}

export interface TransferCompletionAdvance {
  tracker: TransferCompletionTracker;
  changed: TransferRecord[];
}
