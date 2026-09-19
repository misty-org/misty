import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
it("routes staged saves and native opening through typed opaque handles", async () => {
  const request = vi.fn(async () => null);
  const sdk = createMistyAppSDK({ request });
  await expect(sdk.files.replaceCopy("draft", "owned")).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "files.replaceCopy", params: { handle: "draft", target: "owned" } }));
  await expect(sdk.files.openExternal("owned")).resolves.toBeUndefined();
  const calls = request.mock.calls.length;
  await expect(sdk.files.replaceCopy("draft", "")).rejects.toThrow();
  await expect(sdk.files.openExternal("x".repeat(257))).rejects.toThrow();
  expect(request.mock.calls).toHaveLength(calls);
});
