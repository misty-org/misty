import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import { createSdkDrawingAssets } from "./sdkDrawingAssets";

const file = {
  id: "file-a",
  mimeType: "image/png",
  dataURL: "data:image/png;base64,AAH/",
  created: 123,
} as BinaryFileData;
const reference = { assetId: "asset-a", fileId: "file-a", mimeType: "image/png", created: 123 };
function fixture() {
  const handle = crypto.randomUUID();
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => {
    if (message.method === "journal.assets.begin") return { handle };
    if (message.method === "journal.assets.commit")
      return { id: "asset-a", mime_type: "image/png", byte_size: 3, sha256: "0".repeat(64) };
    if (message.method === "journal.assets.open")
      return {
        handle,
        mimeType: "image/png",
        bytes: 3,
        filename: "file-a.png",
        sha256: "0".repeat(64),
      };
    if (message.method === "journal.assets.read") return { data: "AAH/" };
    return undefined;
  });
  const abort = new AbortController();
  const assets = createSdkDrawingAssets(createMistyAppSDK({ request }), "space-a", abort.signal);
  return { request, assets, abort };
}
it("uploads only image bytes through SDK transfers and stores a stable CRDT reference", async () => {
  const f = fixture();
  expect(await f.assets.upload("space-a", "drawing-a", file)).toEqual(reference);
  expect(f.request).toHaveBeenCalledWith({
    method: "journal.assets.begin",
    params: {
      resource: "drawing",
      resourceId: "drawing-a",
      filename: "file-a.png",
      mimeType: "image/png",
      bytes: 3,
      externalFileId: "file-a",
    },
  });
  expect(await f.assets.hydrate("space-a", "drawing-a", reference)).toMatchObject(file);
  expect(
    f.request.mock.calls.filter(([message]) => message.method === "journal.assets.close"),
  ).toHaveLength(2);
  f.abort.abort();
});
it("rejects network URLs, active formats, invalid references and a different Space before RPC", async () => {
  const f = fixture();
  for (const dataURL of [
    "https://external.test/image.png",
    "data:image/svg+xml;base64,AAH/",
    "data:image/png;base64,%%%",
  ]) {
    await expect(
      f.assets.upload("space-a", "drawing-a", { ...file, dataURL } as BinaryFileData),
    ).rejects.toThrow();
  }
  await expect(
    f.assets.hydrate("space-a", "drawing-a", { ...reference, assetId: "../foreign" }),
  ).rejects.toThrow();
  expect(() => f.assets.hydrate("space-b", "drawing-a", reference)).toThrow("another Space");
  expect(
    f.request.mock.calls.filter(([message]) => message.method !== "lifecycle.ready"),
  ).toHaveLength(0);
  f.abort.abort();
});
it("serializes canvas hydration and never starts queued transfers after closing", async () => {
  const f = fixture();
  let release!: (value: unknown) => void;
  f.request.mockImplementation(async (message) => {
    if (message.method === "journal.assets.open")
      return new Promise((resolve) => {
        release = resolve;
      });
    if (message.method === "journal.assets.read") return { data: "AAH/" };
    return undefined;
  });
  const first = f.assets.hydrate("space-a", "drawing-a", reference);
  const second = f.assets.hydrate("space-a", "drawing-a", reference);
  const firstRejected = expect(first).rejects.toThrow("closed");
  const secondRejected = expect(second).rejects.toThrow("closed");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  f.abort.abort();
  release({
    handle: crypto.randomUUID(),
    mimeType: "image/png",
    bytes: 3,
    filename: "file-a.png",
    sha256: "0".repeat(64),
  });
  await Promise.all([firstRejected, secondRejected]);
  expect(
    f.request.mock.calls.filter(([message]) => message.method === "journal.assets.open"),
  ).toHaveLength(1);
});
