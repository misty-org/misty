import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
it("validates owned archive requests and metadata without returning a native path", async () => {
  const result = { format: "zip", entries: [{ path: "日本語.txt", isDir: false, compressedSize: 4, uncompressedSize: 4 }] };
  const request = vi.fn(async () => result);
  const sdk = createMistyAppSDK({ request });
  expect(await sdk.files.listArchive("owned", "zip")).toEqual(result);
  const calls = request.mock.calls.length;
  await expect(sdk.files.listArchive("", "zip")).rejects.toThrow();
  expect(request.mock.calls).toHaveLength(calls);
  request.mockResolvedValueOnce({ ...result, archivePath: "/private/path" } as typeof result);
  await expect(sdk.files.listArchive("owned", "zip")).rejects.toThrow();
});
