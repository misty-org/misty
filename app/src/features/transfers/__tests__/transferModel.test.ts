import type { OperationQueueSnapshot, TransferRecord } from "@/native/contracts";
import { describe, expect, it } from "vitest";
import {
  aggregateTransferProgress,
  buildTransferTreeRows,
  filterAndSortTransfers,
  includeTransferAncestors,
  transferPaused,
} from "../transferModel";

function transfer(id: number, overrides: Partial<TransferRecord> = {}): TransferRecord {
  return {
    id,
    jobId: id,
    operationId: id,
    batchId: 0,
    parentTransferId: 0,
    rootTransferId: id,
    treeDepth: 0,
    transferType: "upload",
    itemType: "local",
    status: "completed",
    conflictPolicy: "ask",
    queueTitle: "",
    fileName: `file-${id}.txt`,
    localSourcePath: `/source/file-${id}.txt`,
    localDestPath: "",
    remoteSourceName: "",
    remoteSourcePath: "",
    remoteDestName: "cloud",
    remoteDestPath: `/target/file-${id}.txt`,
    totalBytes: 100,
    transferredBytes: 100,
    bytesPerSecond: 0,
    errorMessage: "",
    detailMessage: "",
    queuedAtMs: id * 100,
    startedAtMs: id * 100,
    completedAtMs: id * 100,
    cancelable: false,
    retryable: false,
    undoable: false,
    undoTokenId: 0,
    preserveOrder: false,
    paused: false,
    attempt: 1,
    supportsReplace: false,
    supportsKeepBoth: false,
    ...overrides,
  };
}

function snapshotWithOperation(operationId: number, paused: boolean): OperationQueueSnapshot {
  return {
    operations: [{ operationId, paused } as never],
    batches: [],
    conflictDialog: {} as never,
    activeCount: 0,
    maxConcurrent: 4,
    redoAvailable: false,
    paused: false,
    bandwidthLimit: "",
    transferProfileId: "balanced",
    transferProfileName: "Balanced",
  };
}

describe("transfer paused state", () => {
  it("prefers the queue snapshot over a stale transfer record", () => {
    // The record still says running, but the queue already accepted the pause.
    const row = transfer(7, { paused: false });
    expect(transferPaused(row, snapshotWithOperation(7, true))).toBe(true);
  });

  it("prefers the queue snapshot when the record is stale in the other direction", () => {
    const row = transfer(7, { paused: true });
    expect(transferPaused(row, snapshotWithOperation(7, false))).toBe(false);
  });

  it("falls back to the record when the queue does not know the operation", () => {
    const row = transfer(7, { paused: true });
    expect(transferPaused(row, snapshotWithOperation(99, false))).toBe(true);
    expect(transferPaused(row, null)).toBe(true);
  });

  it("falls back to the record for transfers with no operation", () => {
    const row = transfer(7, { operationId: 0, paused: true });
    expect(transferPaused(row, snapshotWithOperation(7, false))).toBe(true);
  });
});

describe("transfer model", () => {
  it("keeps transfer filters and sorting deterministic", () => {
    const rows = [
      transfer(1, { fileName: "beta.txt", status: "in_progress", completedAtMs: 0 }),
      transfer(2, { fileName: "alpha.txt", remoteDestName: "backup" }),
      transfer(3, { fileName: "gamma.txt", transferType: "download" }),
    ];

    const filtered = filterAndSortTransfers(rows, {
      providerFilters: new Set(["cloud"]),
      typeFilters: new Set(["upload"]),
      locationScope: "remote",
      statusFilter: "all",
      sortKey: "name",
      sortDirection: "asc",
    });

    expect(filtered.map((row) => row.id)).toEqual([1]);
  });

  it("restores matching ancestors and reveals children only when expanded", () => {
    const root = transfer(1, { fileName: "folder", totalBytes: 0, transferredBytes: 0 });
    const child = transfer(2, { parentTransferId: 1, rootTransferId: 1 });

    const withAncestor = includeTransferAncestors([child], [root, child]);
    expect(withAncestor.map((row) => row.id)).toEqual([1, 2]);
    expect(buildTransferTreeRows(withAncestor, new Set()).map((entry) => entry.row.id)).toEqual([
      1,
    ]);
    expect(buildTransferTreeRows(withAncestor, new Set([1])).map((entry) => entry.row.id)).toEqual([
      1, 2,
    ]);
  });

  it("aggregates descendant progress for a completed transfer tree", () => {
    const root = transfer(1, { totalBytes: 0, transferredBytes: 0 });
    const first = transfer(2, {
      parentTransferId: 1,
      totalBytes: 200,
      transferredBytes: 200,
      bytesPerSecond: 10,
    });
    const second = transfer(3, {
      parentTransferId: 1,
      totalBytes: 300,
      transferredBytes: 150,
      bytesPerSecond: 20,
    });

    expect(aggregateTransferProgress(root, [root, first, second])).toEqual({
      transferredBytes: 350,
      totalBytes: 500,
      bytesPerSecond: 30,
      aggregated: true,
    });
  });
});
