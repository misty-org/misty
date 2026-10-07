import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationQueueSnapshot, TransferRecord } from "@/native/ipc";
import * as native from "@/native/transfers-tools";
import { TransfersPage } from "./TransfersPage";
import { transferActions } from "./transferModel";

vi.mock("@/native/transfers-tools", () => ({
  transfersSnapshot: vi.fn(),
  operationQueueSnapshot: vi.fn(),
  operationQueueCancel: vi.fn(),
  operationQueuePause: vi.fn(),
  operationQueuePauseAll: vi.fn(),
  operationQueueResume: vi.fn(),
  operationQueueResumeAll: vi.fn(),
  operationQueueRetryTransfer: vi.fn(),
  operationQueueUndo: vi.fn(),
  operationQueueRedo: vi.fn(),
}));
const row: TransferRecord = {
  id: 1,
  operationId: 11,
  jobId: 1,
  batchId: 0,
  parentTransferId: 0,
  rootTransferId: 0,
  treeDepth: 0,
  transferType: "copy",
  itemType: "local",
  status: "in_progress",
  conflictPolicy: "ask",
  queueTitle: "Copy files",
  fileName: "Project.zip",
  localSourcePath: "/Users/test/Project.zip",
  localDestPath: "/Volumes/Backup/Project.zip",
  remoteSourceName: "",
  remoteSourcePath: "",
  remoteDestName: "",
  remoteDestPath: "",
  totalBytes: 1000,
  transferredBytes: 250,
  bytesPerSecond: 100,
  errorMessage: "",
  detailMessage: "",
  queuedAtMs: 1000,
  startedAtMs: 1001,
  completedAtMs: 0,
  cancelable: true,
  retryable: false,
  undoable: false,
  undoTokenId: 0,
  preserveOrder: false,
  paused: false,
  attempt: 1,
  supportsReplace: true,
  supportsKeepBoth: true,
};
const operation = {
  operationId: 11,
  status: "in_progress",
  cancelable: true,
  paused: false,
} as OperationQueueSnapshot["operations"][number];
const queue = {
  operations: [operation],
  batches: [],
  activeCount: 1,
  paused: false,
  redoAvailable: false,
  conflictDialog: { open: false },
} as unknown as OperationQueueSnapshot;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(native.transfersSnapshot).mockResolvedValue({ rows: [row], totalCount: 1, dbPath: "" });
  vi.mocked(native.operationQueueSnapshot).mockResolvedValue(queue);
  vi.mocked(native.operationQueuePauseAll).mockResolvedValue({ ...queue, paused: true });
});
afterEach(cleanup);

describe("Transfers page", () => {
  it("shows native progress and opens source/destination details", async () => {
    render(<TransfersPage />);
    expect(await screen.findByRole("button", { name: "Project.zip" })).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "Project.zip" }));
    expect(screen.getByRole("region", { name: "Transfer details" }).textContent).toContain(
      "/Volumes/Backup/Project.zip",
    );
  });
  it("queries the selected status and search across persisted history", async () => {
    render(<TransfersPage />);
    await screen.findByRole("button", { name: "Project.zip" });
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() =>
      expect(native.transfersSnapshot).toHaveBeenCalledWith({
        section: "failed",
        search: "",
        offset: 0,
        limit: 50,
      }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search transfers" }), {
      target: { value: "Project" },
    });
    await waitFor(() =>
      expect(native.transfersSnapshot).toHaveBeenCalledWith({
        section: "failed",
        search: "Project",
        offset: 0,
        limit: 50,
      }),
    );
  });
  it("pauses scheduling through the native queue", async () => {
    render(<TransfersPage />);
    await screen.findByRole("button", { name: "Project.zip" });
    fireEvent.click(screen.getByRole("button", { name: "Pause queue" }));
    await waitFor(() => expect(native.operationQueuePauseAll).toHaveBeenCalledOnce());
  });
  it.each([
    { label: "Pause", action: "operationQueuePause", record: row, live: operation, argument: 11 },
    { label: "Cancel", action: "operationQueueCancel", record: row, live: operation, argument: 11 },
    {
      label: "Resume",
      action: "operationQueueResume",
      record: { ...row, status: "queued", paused: true },
      live: { ...operation, status: "queued", paused: true },
      argument: 11,
    },
    {
      label: "Retry",
      action: "operationQueueRetryTransfer",
      record: { ...row, status: "failed", retryable: true },
      live: null,
      argument: 1,
    },
    {
      label: "Undo move",
      action: "operationQueueUndo",
      record: {
        ...row,
        transferType: "move",
        status: "completed",
        undoable: true,
        undoTokenId: 42,
      },
      live: null,
      argument: 42,
    },
  ] as const)(
    "runs $label directly from the row",
    async ({ label, action, record, live, argument }) => {
      vi.mocked(native.transfersSnapshot).mockResolvedValue({
        rows: [record],
        totalCount: 1,
        dbPath: "",
      });
      vi.mocked(native.operationQueueSnapshot).mockResolvedValue({
        ...queue,
        operations: live ? [live] : [],
      });
      vi.mocked(native[action]).mockResolvedValue(queue);
      render(<TransfersPage />);
      fireEvent.click(await screen.findByRole("button", { name: label }));
      await waitFor(() => expect(native[action]).toHaveBeenCalledExactlyOnceWith(argument));
      expect(screen.queryByRole("region", { name: "Transfer details" })).toBeNull();
    },
  );
  it("enables redo after undo and consumes the returned redo state immediately", async () => {
    const completed: TransferRecord = {
      ...row,
      transferType: "move",
      status: "completed",
      undoable: true,
      undoTokenId: 42,
    };
    vi.mocked(native.transfersSnapshot).mockResolvedValue({
      rows: [completed],
      totalCount: 1,
      dbPath: "",
    });
    vi.mocked(native.operationQueueUndo).mockImplementation(async () => {
      vi.mocked(native.operationQueueSnapshot).mockReturnValue(new Promise(() => {}));
      return { ...queue, redoAvailable: true };
    });
    vi.mocked(native.operationQueueRedo).mockResolvedValue(queue);
    render(<TransfersPage />);
    const undo = await screen.findByRole("button", { name: "Undo move" });
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(undo);
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(native.operationQueueRedo).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
  });
  it("prevents duplicate actions while pending and reports action failures", async () => {
    let rejectAction!: (error: Error) => void;
    vi.mocked(native.operationQueueCancel).mockReturnValue(
      new Promise((_, reject) => {
        rejectAction = reject;
      }),
    );
    render(<TransfersPage />);
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    expect(native.operationQueueCancel).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    rejectAction(new Error("Transfer could not be canceled"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Transfer could not be canceled",
    );
    await waitFor(() => expect((cancel as HTMLButtonElement).disabled).toBe(false));
  });
  it("shows failures with a retry instead of an empty success state", async () => {
    vi.mocked(native.transfersSnapshot).mockRejectedValue(new Error("History unavailable"));
    render(<TransfersPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("History unavailable");
    expect(screen.queryByText("No transfers yet")).toBeNull();
    vi.mocked(native.transfersSnapshot).mockResolvedValue({ rows: [], totalCount: 0, dbPath: "" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No transfers yet")).toBeTruthy();
  });
  it("only exposes actions supported by the live operation", () => {
    expect(transferActions(row)).toMatchObject({
      cancel: false,
      pause: false,
      resume: false,
      undo: false,
    });
    expect(transferActions(row, operation)).toMatchObject({ cancel: true, pause: true });
    expect(transferActions({ ...row, paused: true }, { ...operation, paused: true })).toMatchObject(
      { pause: false, resume: false },
    );
    expect(
      transferActions(
        { ...row, status: "queued", paused: true },
        { ...operation, status: "queued", paused: true },
      ).resume,
    ).toBe(true);
    expect(
      transferActions({ ...row, status: "completed", undoable: true, undoTokenId: 1 }).undo,
    ).toBe(true);
  });
});
