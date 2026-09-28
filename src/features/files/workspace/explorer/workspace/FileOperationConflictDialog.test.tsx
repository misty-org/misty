import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationQueueSnapshot } from "@/native/ipc";
import { operationQueueResolveConflict } from "@/native/transfers-tools";
import { useOperationQueueStore } from "../store";
import { FileOperationConflictDialog } from "./FileOperationConflictDialog";

vi.mock("@/native/transfers-tools", () => ({
  operationQueueResolveConflict: vi.fn(),
}));
const conflict = {
  open: true,
  operationId: 7,
  batchId: 2,
  applyToBatch: false,
  supportsReplace: true,
  supportsKeepBoth: true,
  selectedPolicy: "ask",
  title: "A file already exists",
  sourceLabel: "/source/report.txt",
  targetLabel: "/destination/report.txt",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  useOperationQueueStore.setState({
    snapshot: { conflictDialog: conflict } as OperationQueueSnapshot,
  });
});

describe("file operation conflicts", () => {
  it("resolves a name collision without a Transfers workspace", async () => {
    const next = { conflictDialog: { ...conflict, open: false } } as OperationQueueSnapshot;
    vi.mocked(operationQueueResolveConflict).mockResolvedValue(next);
    render(<FileOperationConflictDialog />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Apply to remaining files" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
    await waitFor(() =>
      expect(operationQueueResolveConflict).toHaveBeenCalledWith(7, "keep_both", true),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("keeps a failed resolution visible and hides unsupported choices", async () => {
    useOperationQueueStore.setState({
      snapshot: {
        conflictDialog: { ...conflict, supportsReplace: false, supportsKeepBoth: false },
      } as OperationQueueSnapshot,
    });
    vi.mocked(operationQueueResolveConflict).mockRejectedValue(
      new Error("Destination unavailable"),
    );
    render(<FileOperationConflictDialog />);
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep both" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Destination unavailable");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});
