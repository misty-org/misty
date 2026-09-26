import {
  advanceTransferCompletionTracker,
  emptyTransferCompletionTracker,
} from "@/app/layouts/transferCompletionNotifications";
import type { TransferRecord } from "@/native/contracts";
import type { TransferStatus } from "@/native/contracts/primitives";
import { describe, expect, it } from "vitest";

const terminalStatuses = new Set<TransferStatus>([
  "completed",
  "failed",
  "canceled",
  "interrupted",
]);

function transfer(id: number, status: TransferStatus): TransferRecord {
  return { id, status } as TransferRecord;
}

describe("transfer completion activity", () => {
  it("does not recreate activity from completed rows during startup hydration", () => {
    const hydrated = advanceTransferCompletionTracker(
      emptyTransferCompletionTracker(),
      [transfer(1, "completed"), transfer(2, "failed")],
      terminalStatuses,
    );

    expect(hydrated.changed).toEqual([]);
    expect(hydrated.tracker.ready).toBe(true);
    expect(hydrated.tracker.statuses).toEqual({ 1: "completed", 2: "failed" });
  });

  it("announces only a status that becomes terminal after hydration", () => {
    const hydrated = advanceTransferCompletionTracker(
      emptyTransferCompletionTracker(),
      [transfer(1, "in_progress"), transfer(2, "completed")],
      terminalStatuses,
    );
    const updated = advanceTransferCompletionTracker(
      hydrated.tracker,
      [transfer(1, "completed"), transfer(2, "completed")],
      terminalStatuses,
    );

    expect(updated.changed.map((row) => row.id)).toEqual([1]);
  });
});
