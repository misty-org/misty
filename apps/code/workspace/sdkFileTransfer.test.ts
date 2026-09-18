import { afterEach, describe, expect, it, vi } from "vitest";
import type { MistyFileTransferSDK, MistyFileTransferStatus } from "@misty/sdk";
import { runSdkFileTransfer, SdkFileTransferError } from "./sdkFileTransfer";
import { openSdkCodeProject, transferSdkCodeEntry } from "./sdkCodeProject";
import { createSdkCodeFileFixture } from "./sdkCodeProject.fixture";

const request = {
  sourceDirectory: "from",
  destinationDirectory: "to",
  entry: "u:YQ",
  operation: "copy" as const,
};
const completed: MistyFileTransferStatus = {
  status: "completed",
  bytes: 123,
  files: 1,
  message: "Done",
  result: { entry: "u:YQ", name: "a", kind: "file", sourceRemoved: false },
};
function jobs() {
  return {
    transferStart: vi.fn(async () => ({ jobId: "owned-job" })),
    transferStatus: vi.fn(async (): Promise<MistyFileTransferStatus> => completed),
    transferCancel: vi.fn(async () => undefined),
    transferClose: vi.fn(async () => undefined),
  } satisfies MistyFileTransferSDK;
}
afterEach(() => vi.useRealTimers());

describe("owned SDK transfer lifecycle", () => {
  it("reports progress and closes the completed job", async () => {
    vi.useFakeTimers();
    const files = jobs(),
      progress = vi.fn();
    files.transferStatus.mockResolvedValueOnce({ ...completed, status: "running", result: null });
    const result = runSdkFileTransfer(files, request, { onProgress: progress });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual(completed.result);
    expect(progress.mock.calls.map(([status]) => status.status)).toEqual(["running", "completed"]);
    expect(files.transferClose).toHaveBeenCalledWith("owned-job");
  });
  it("cancels and closes a job whose start reply arrives after its owner aborts", async () => {
    const files = jobs(),
      controller = new AbortController();
    let resolve!: (job: { jobId: string }) => void;
    files.transferStart.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    files.transferStatus.mockResolvedValueOnce({
      ...completed,
      status: "cancelled",
      message: "Cancelled",
      result: null,
    });
    const result = runSdkFileTransfer(files, request, { signals: [controller.signal] });
    const rejected = expect(result).rejects.toBeInstanceOf(SdkFileTransferError);
    controller.abort();
    resolve({ jobId: "owned-job" });
    await rejected;
    expect(files.transferCancel).toHaveBeenCalledWith("owned-job");
    expect(files.transferClose).toHaveBeenCalledWith("owned-job");
    await expect(
      runSdkFileTransfer(files, request, { signals: [controller.signal] }),
    ).rejects.toThrow("cancelled");
    expect(files.transferStart).toHaveBeenCalledTimes(1);
  });
  it("closes jobs after failed polls or progress callbacks and retains partial-move receipts", async () => {
    const files = jobs();
    files.transferStatus.mockRejectedValueOnce(new Error("Revoked"));
    await expect(runSdkFileTransfer(files, request)).rejects.toThrow("Revoked");
    await expect(
      runSdkFileTransfer(files, request, {
        onProgress() {
          throw new Error("UI closed");
        },
      }),
    ).rejects.toThrow("UI closed");
    const partial = {
      ...completed,
      status: "failed" as const,
      message: "Source changed; destination copy kept",
    };
    files.transferStatus.mockResolvedValueOnce(partial);
    await expect(runSdkFileTransfer(files, request)).rejects.toMatchObject({ status: partial });
    expect(files.transferClose).toHaveBeenCalledTimes(3);
  });
});

it("transfers between owned SDK projects using retained handles, releasing temporary grants", async () => {
  const fixture = createSdkCodeFileFixture();
  const source = (await openSdkCodeProject(fixture.sdk, { write: false }))!;
  const destination = (await openSdkCodeProject(fixture.sdk))!;
  try {
    const result = await transferSdkCodeEntry(
      source,
      destination,
      `${source.root}/src/${fixture.file.name}`,
      destination.root,
      "copy",
    );
    expect(result.path).toBe(`${destination.root}/${fixture.file.name}`);
    expect(fixture.root.children!.get(fixture.file.name)?.text).toBe(fixture.file.text);
    expect(fixture.transfers.size).toBe(0);
    expect(fixture.handles.size).toBe(2);
    const call = fixture.request.mock.calls.find(
      ([call]) => call.method === "files.transferStart",
    )![0];
    expect(JSON.stringify(call.params)).not.toContain("/misty-project/");
    await expect(
      transferSdkCodeEntry(source, destination, `${source.root}/src`, destination.root, "move"),
    ).rejects.toThrow("writable");
  } finally {
    await source.close();
    await destination.close();
  }
  expect(fixture.handles.size).toBe(0);
});

it("rejects another app's project, traversal, and closed project owners before starting work", async () => {
  const fixture = createSdkCodeFileFixture(),
    other = createSdkCodeFileFixture();
  const project = (await openSdkCodeProject(fixture.sdk))!,
    foreign = (await openSdkCodeProject(other.sdk))!;
  try {
    await expect(
      transferSdkCodeEntry(project, foreign, `${project.root}/src`, foreign.root, "copy"),
    ).rejects.toThrow("this Code app");
    await expect(
      transferSdkCodeEntry(project, project, `${project.root}/../private`, project.root, "copy"),
    ).rejects.toThrow("Invalid");
    await project.close();
    await expect(
      transferSdkCodeEntry(project, project, `${project.root}/src`, project.root, "copy"),
    ).rejects.toThrow("closed");
    expect(
      fixture.request.mock.calls.filter(([call]) => call.method === "files.transferStart"),
    ).toHaveLength(0);
  } finally {
    await project.close();
    await foreign.close();
  }
});
