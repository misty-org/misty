import type { TransferRecord } from "@/native/contracts";
import type { TransferStatus } from "@/native/contracts/primitives";

export interface TransferCompletionTracker {
  ready: boolean;
  statuses: Record<number, TransferStatus>;
}

export interface TransferCompletionAdvance {
  tracker: TransferCompletionTracker;
  changed: TransferRecord[];
}
