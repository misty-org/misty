import { createMistyAppSDK } from "@misty/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createSdkJournalAssets, pickSdkJournalImage } from "./sdkJournalAssets";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("reads a picked image with native-sized chunks and releases its file capability", async () => {
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => {
    if (message.method === "files.pick")
      return { handle: "file-a", name: "image.PNG", bytes: 65537 };
    if (message.method === "files.readBytes")
      return new ArrayBuffer((message.params as { length: number }).length);
    return undefined;
  });
  const file = await pickSdkJournalImage(
    createMistyAppSDK({ request }),
    new AbortController().signal,
  );
  expect(file?.size).toBe(65537);
  expect(file?.type).toBe("image/png");
  expect(request).toHaveBeenCalledWith({
    method: "files.readBytes",
    params: { handle: "file-a", offset: 0, length: 65536 },
  });
  expect(request).toHaveBeenCalledWith({
    method: "files.readBytes",
    params: { handle: "file-a", offset: 65536, length: 1 },
  });
  expect(request).toHaveBeenLastCalledWith({
    method: "files.release",
    params: { handle: "file-a" },
  });
});
it("releases a picker result that arrives after unmount without reading the file", async () => {
  const abort = new AbortController();
  let finish!: (result: unknown) => void;
  const request = vi.fn(async (message: { method: string }) =>
    message.method === "files.pick"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : undefined,
  );
  const pending = pickSdkJournalImage(createMistyAppSDK({ request }), abort.signal);
  abort.abort();
  finish({ handle: "late-file", name: "image.png", bytes: 3 });
  expect(await pending).toBeUndefined();
  expect(request).toHaveBeenLastCalledWith({
    method: "files.release",
    params: { handle: "late-file" },
  });
  expect(request.mock.calls.some(([x]) => x.method === "files.readBytes")).toBe(false);
});
it("shares verified image URLs within a view, revokes them on release, and rejects another Space", async () => {
  const create = vi.fn(() => "blob:owned-image"),
    revoke = vi.fn();
  const NativeURL = URL;
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const handle = crypto.randomUUID();
  const request = vi.fn(async (message: { method: string }) => {
    if (message.method === "journal.assets.open")
      return {
        handle,
        filename: "image.png",
        mimeType: "image/png",
        bytes: 3,
        sha256: "0".repeat(64),
      };
    if (message.method === "journal.assets.read") return { data: "AAH/" };
    return undefined;
  });
  const abort = new AbortController(),
    assets = createSdkJournalAssets(createMistyAppSDK({ request }), "space-a", abort.signal);
  const reference = "/spaces/space-a/notes/note-a/assets/asset-a/download";
  const [a, b] = await Promise.all([assets.resolveNote(reference), assets.resolveNote(reference)]);
  expect(a.url).toBe(b.url);
  expect(create).toHaveBeenCalledOnce();
  expect(request.mock.calls.filter(([x]) => x.method === "journal.assets.open")).toHaveLength(1);
  a.release();
  expect(revoke).not.toHaveBeenCalled();
  b.release();
  b.release();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:owned-image");
  await expect(assets.resolveNote(reference.replace("space-a", "space-b"))).rejects.toThrow(
    "another Space",
  );
  await expect(assets.resolveNote("javascript:alert(1)")).rejects.toThrow();
  const c = await assets.resolveNote(reference);
  abort.abort();
  expect(revoke).toHaveBeenCalledTimes(2);
  c.release();
  expect(revoke).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});
