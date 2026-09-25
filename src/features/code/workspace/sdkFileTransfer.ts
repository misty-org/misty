import type {
  MistyFileTransferSDK,
  MistyFileTransferRequest,
  MistyFileTransferStatus,
} from "@misty/sdk";

export class SdkFileTransferError extends Error {
  constructor(public readonly status: MistyFileTransferStatus) {
    super(status.message);
    this.name = "SdkFileTransferError";
  }
}

/** Owns a native job until it finishes, including cancellation and late start replies. */
export async function runSdkFileTransfer(
  files: MistyFileTransferSDK,
  request: MistyFileTransferRequest,
  options: {
    signals?: readonly AbortSignal[];
    onProgress?(status: MistyFileTransferStatus): void;
  } = {},
) {
  const aborted = () => options.signals?.some((signal) => signal.aborted);
  if (aborted()) throw new Error("This file transfer was cancelled.");
  const { jobId } = await files.transferStart(request);
  let cancelled = false;
  try {
    for (;;) {
      if (aborted() && !cancelled) {
        cancelled = true;
        await files.transferCancel(jobId);
      }
      const status = await files.transferStatus(jobId);
      options.onProgress?.(status);
      if (status.status === "completed") {
        if (!status.result) throw new Error("The transfer finished without a destination entry.");
        return status.result;
      }
      if (status.status !== "running") throw new SdkFileTransferError(status);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    // Closing also cancels a still-running job after a failed poll or UI callback.
    await files.transferClose(jobId).catch(() => undefined);
  }
}
