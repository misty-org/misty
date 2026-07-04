import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MistyAppSDK, TransferRecord } from "@misty/sdk";
import { NativeTransfersView } from "./NativeTransfersView";

afterEach(cleanup);
it("reads existing native history and uses native operation IDs for pause and resume", async () => {
  const row = {
    id: 71,
    operationId: 23,
    fileName: "launch.mov",
    queueTitle: "",
    localSourcePath: "/launch.mov",
    transferredBytes: 5,
    totalBytes: 10,
    status: "in_progress",
    paused: false,
    cancelable: true,
  } as TransferRecord;
  const transfers = vi.fn(async () => ({
    rows: [row],
    totalCount: 1,
    dbPath: "/existing/history.db",
  }));
  const pause = vi.fn(async () => {
    row.paused = true;
  });
  const resume = vi.fn(async () => {
    row.paused = false;
  });
  const misty = { fileSystem: { transfers, pause, resume } } as unknown as MistyAppSDK;
  render(<NativeTransfersView misty={misty} query="launch" />);
  expect(await screen.findByText("launch.mov")).toBeTruthy();
  expect(transfers).toHaveBeenCalledWith({ search: "launch", offset: 0, limit: 100 });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  });
  expect(pause).toHaveBeenCalledWith(23);
  await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  });
  expect(resume).toHaveBeenCalledWith(23);
});
it("reports native history failures without claiming the history is empty", async () => {
  const misty = {
    fileSystem: {
      transfers: vi.fn(async () => {
        throw new Error("Device unavailable");
      }),
    },
  } as unknown as MistyAppSDK;
  render(<NativeTransfersView misty={misty} query="" />);
  expect((await screen.findByRole("alert")).textContent).toContain("Device unavailable");
  expect(screen.queryByText("No device transfers.")).toBeNull();
});
