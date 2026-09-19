import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";

it("validates opaque metadata and native watch requests and results", async () => {
  const metadata = { kind: "file", bytes: 8, modifiedMs: 12, createdMs: null, readOnly: false, writeGranted: false };
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "files.stat") return metadata;
    if (method === "files.watchDirectory") return { watcher: "owned-watch" };
    if (method === "files.watchStatus") return { revision: 4, active: true, reason: null };
    return null;
  });
  const files = createMistyAppSDK({ request }).files;
  expect(await files.stat("owned-file")).toEqual(metadata);
  const { watcher } = await files.watchDirectory("owned-directory");
  expect(await files.watchStatus(watcher)).toEqual({ revision: 4, active: true, reason: null });
  await files.watchClose(watcher);
  expect(request).toHaveBeenLastCalledWith({ method: "files.watchClose", params: { watcher } });
});
it("rejects invalid handles, unsafe metadata, and native paths in observation replies", async () => {
  const request = vi.fn(async () => ({ watcher: "owned", path: "/private/project" }));
  const files = createMistyAppSDK({ request }).files;
  await expect(files.watchDirectory("directory")).rejects.toThrow();
  const before = request.mock.calls.length;
  await expect(files.stat("")).rejects.toThrow();
  await expect(files.watchStatus("x".repeat(257))).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(before);
  const unsafe = createMistyAppSDK({ request: async () => ({
    kind: "file", bytes: Number.MAX_SAFE_INTEGER + 1, modifiedMs: 1, createdMs: null, readOnly: false, writeGranted: true,
  }) }).files;
  await expect(unsafe.stat("file")).rejects.toThrow();
});
