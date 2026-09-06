import { createMistyAppSDK } from "../packages/sdk/src/index.js";
import { expect, it, vi } from "vitest";

it("copies a PNG through the named native method without exposing browser clipboard APIs", async () => {
  const request = vi.fn(async (_message: { method: string; params?: unknown }) => undefined);
  const sdk = createMistyAppSDK({ request });
  await sdk.clipboard.writeImage(new Blob([new Uint8Array([0, 1, 255])], { type: "image/png" }));
  expect(request).toHaveBeenCalledWith({ method: "clipboard.writeImage", params: { mimeType: "image/png", data: "AAH/" } });
});
it("rejects unsupported and oversized clipboard images before requesting a device grant", async () => {
  const request = vi.fn(async (_message: { method: string; params?: unknown }) => undefined);
  const sdk = createMistyAppSDK({ request });
  await expect(sdk.clipboard.writeImage(new Blob(["<svg/>"], { type: "image/svg+xml" }))).rejects.toThrow("PNG");
  await expect(sdk.clipboard.writeImage(new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "image/png" }))).rejects.toThrow("4 MB");
  expect(request.mock.calls.filter(([message]) => (message as { method: string }).method === "clipboard.writeImage")).toHaveLength(0);
});

it("reads a bounded native PNG or an empty image clipboard through its contract", async () => {
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => message.method === "clipboard.readImage" ? { mimeType: "image/png", data: "AAH/" } : undefined);
  const sdk = createMistyAppSDK({ request });
  const image = await sdk.clipboard.readImage();
  expect(image?.type).toBe("image/png");
  expect(await image?.arrayBuffer()).toEqual(new Uint8Array([0, 1, 255]).buffer);
  request.mockResolvedValueOnce(null);
  expect(await sdk.clipboard.readImage()).toBeNull();
  request.mockResolvedValueOnce({ mimeType: "image/svg+xml", data: "AAH/" });
  await expect(sdk.clipboard.readImage()).rejects.toThrow();
});
