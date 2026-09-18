import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
it("lists a selected folder and opens a returned opaque entry using validated SDK contracts", async () => {
  const item = {
    entry: "u:aGVsbG8udHh0",
    name: "hello.txt",
    kind: "file",
    bytes: 5,
  };
  const request = vi.fn(async (input: { method: string; params?: unknown }) => {
    if (input.method === "files.listDirectory")
      return { entries: [item], nextOffset: 1 };
    if (input.method === "files.openEntry")
      return { handle: "owned-file", name: item.name, kind: "file", bytes: 5 };
  });
  const files = createMistyAppSDK({ request }).files;
  expect((await files.listDirectory("chosen", { limit: 1 })).entries).toEqual([
    item,
  ]);
  const opened = await files.openEntry("chosen", item.entry);
  expect(opened.handle).toBe("owned-file");
  expect(request).toHaveBeenCalledWith({
    method: "files.openEntry",
    params: { directory: "chosen", entry: item.entry, write: false },
  });
  await files.release(opened.handle);
  expect(request).toHaveBeenLastCalledWith({
    method: "files.release",
    params: { handle: "owned-file" },
  });
});
it("rejects caller paths and excessive pagination before transport, and invalid device replies", async () => {
  const request = vi.fn(async () => ({
    entries: [],
    nextOffset: null,
    absolutePath: "/private/folder",
  }));
  const files = createMistyAppSDK({ request }).files;
  const before = request.mock.calls.length;
  await expect(files.listDirectory("chosen", { limit: 201 })).rejects.toThrow();
  await expect(files.listDirectory("chosen", { offset: -1 })).rejects.toThrow();
  await expect(files.openEntry("chosen", "/etc/passwd")).rejects.toThrow();
  expect(request.mock.calls).toHaveLength(before);
  await expect(files.listDirectory("chosen")).rejects.toThrow();
});
it("creates and renames child entries and requires explicit recursive removal", async () => {
  const request = vi.fn(async (input: { method: string; params?: unknown }) => {
    if (input.method === "files.createEntry")
      return { entry: "u:bWFpbi5ycw", name: "main.rs", kind: "file" };
    if (input.method === "files.renameEntry")
      return { entry: "u:bmV3LnJz", name: "new.rs" };
    return null;
  });
  const files = createMistyAppSDK({ request }).files;
  const entry = await files.createEntry("folder", "main.rs", "file");
  const renamed = await files.renameEntry("folder", entry.entry, "new.rs");
  await files.removeEntry("folder", renamed.entry);
  expect(request).toHaveBeenLastCalledWith({
    method: "files.removeEntry",
    params: { directory: "folder", entry: renamed.entry, recursive: false },
  });
  await files.removeEntry("folder", "u:bmVzdGVk", { recursive: true });
  expect(request).toHaveBeenLastCalledWith({
    method: "files.removeEntry",
    params: { directory: "folder", entry: "u:bmVzdGVk", recursive: true },
  });
});
it("rejects path and oversized Unicode names before folder mutations reach the host", async () => {
  const request = vi.fn(async () => null);
  const files = createMistyAppSDK({ request }).files;
  const initial = request.mock.calls.length;
  for (const name of [
    "../escape",
    "/absolute",
    ".",
    "..",
    "a/b",
    "a\0b",
    "🦀".repeat(64),
  ]) {
    await expect(files.createEntry("folder", name, "file")).rejects.toThrow();
    await expect(
      files.renameEntry("folder", "u:bWFpbg", name),
    ).rejects.toThrow();
  }
  await expect(files.removeEntry("folder", "/absolute")).rejects.toThrow();
  expect(request.mock.calls).toHaveLength(initial);
});
