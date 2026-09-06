import { describe, expect, it, vi } from "vitest";
import { createMistyAppSDK } from "../packages/sdk/src/index.js";
import { mistyFileTransferContracts } from "../packages/contracts/src/index.js";

describe("file transfer job contract", () => {
  it("validates and dispatches transfer jobs using only granted handles and entry tokens", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "files.transferStart") return { jobId: "transfer-a" };
      if (method === "files.transferStatus") return { status: "completed", bytes: 300_000_000, files: 1, message: "Done", result: { entry: "u:YS50cw", name: "a.ts", kind: "file", sourceRemoved: true } };
      return null;
    });
    const sdk = createMistyAppSDK({ request });
    const input = { sourceDirectory: "source", entry: "u:YS50cw", destinationDirectory: "destination", operation: "move" as const };
    expect(await sdk.files.transferStart(input)).toEqual({ jobId: "transfer-a" });
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: "files.transferStart", params: { ...input, conflict: "error" } }));
    expect(await sdk.files.transferStatus("transfer-a")).toMatchObject({ bytes: 300_000_000, result: { sourceRemoved: true } });
    await sdk.files.transferCancel("transfer-a"); await sdk.files.transferClose("transfer-a");
    expect(request.mock.calls.map(([call]) => call.method).filter((method) => method !== "lifecycle.ready")).toEqual(["files.transferStart", "files.transferStatus", "files.transferCancel", "files.transferClose"]);
  });
  it("rejects ambient paths, malformed handles and invalid or excess native response fields", async () => {
    const params = mistyFileTransferContracts["files.transferStart"].params;
    expect(params.safeParse({ sourceDirectory: "source", entry: "../file", destinationDirectory: "destination", operation: "copy" }).success).toBe(false);
    expect(params.safeParse({ sourceDirectory: "source", entry: "u:YS50cw", destinationDirectory: "destination", operation: "copy", path: "/private/file" }).success).toBe(false);
    const request = vi.fn(async () => ({ status: "completed", bytes: Number.MAX_SAFE_INTEGER + 1, files: 1, message: "Done", result: null }));
    const sdk = createMistyAppSDK({ request });
    await expect(sdk.files.transferStatus("job")).rejects.toThrow();
    await expect(sdk.files.transferCancel("")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2); // Includes the SDK lifecycle handshake.
    const status = mistyFileTransferContracts["files.transferStatus"].result;
    expect(status.safeParse({ status: "failed", bytes: 0, files: 0, message: "Failed", result: null, nativePath: "/private" }).success).toBe(false);
  });
});
