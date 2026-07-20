import { describe, expect, it } from "vitest";
import type { TransferRecord } from "../../../api/types";
import {
  aggregateTransferProgress,
  buildTransferTreeRows,
  filterAndSortTransfers,
  includeTransferAncestors,
} from "./transferModel";

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
