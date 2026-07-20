import type {
  TransferCompletionTracker,
  TransferCompletionAdvance,
} from "@/models/interfaces/layouts/transferCompletionNotifications";
export type {
  TransferCompletionTracker,
  TransferCompletionAdvance,
} from "@/models/interfaces/layouts/transferCompletionNotifications";
import type { TransferStatus } from "@/models/types/services/misty-api";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";

export const emptyTransferCompletionTracker = (): TransferCompletionTracker => ({
  ready: false,
  statuses: {},
});

export function advanceTransferCompletionTracker(
  current: TransferCompletionTracker,
  rows: TransferRecord[],
  terminalStatuses: ReadonlySet<TransferStatus>,
): TransferCompletionAdvance {
  const statuses = Object.fromEntries(rows.map((row) => [row.id, row.status])) as Record<
    number,
    TransferStatus
  >;

  // The first durable snapshot is hydration, not new work. It must only seed
  // the baseline or every historical completion will be announced on restart.
  if (!current.ready) {
    return {
      tracker: { ready: true, statuses },
      changed: [],
    };
  }

  return {
    tracker: { ready: true, statuses },
    changed: rows.filter(
      (row) => terminalStatuses.has(row.status) && current.statuses[row.id] !== row.status,
    ),
  };
}
