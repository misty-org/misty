import { expect, it, vi } from "vitest";
import { createMistyAppSDK, parseAppRpcRequest, parseMethodParams, parseMethodResult, MISTY_JOURNAL_ASSET_MAX_BYTES } from "@misty/sdk";

it("binds every asset route to its app Space and forbids arbitrary finalize headers in RPC JSON", () => {
  expect(parseAppRpcRequest({ protocol: 2, method: "notes.assets.finalize", params: { path: { noteID: "note-a", uploadID: "upload-a" } } }, "space-a").params.path)
    .toEqual({ spaceID: "space-a", noteID: "note-a", uploadID: "upload-a" });
  expect(() => parseMethodParams("notes.assets.finalize", { path: { noteID: "note-a", uploadID: "upload-a" }, headers: { Authorization: "foreign" } })).toThrow();
  expect(() => parseAppRpcRequest({ protocol: 2, method: "drawings.assets.download", params: { path: { spaceID: "space-b", drawingID: "drawing-a", assetID: "asset-a" } } }, "space-a"))
    .toThrow(expect.objectContaining({ code: "space_mismatch" }));
  expect(() => parseMethodParams("drawings.assets.reserve", { path: { drawingID: "drawing-a" }, body: { filename: "a.png", mime_type: "image/png", byte_size: 3, sha256: "0".repeat(64) } })).toThrow();
});
it("rejects executable MIME, oversized files and malformed storage descriptors", () => {
  const body = { filename: "a.png", mime_type: "image/png", byte_size: 3, sha256: "0".repeat(64) };
  for (const patch of [{ byte_size: MISTY_JOURNAL_ASSET_MAX_BYTES + 1 }, { mime_type: "image/svg+xml" }, { sha256: "invalid" }])
    expect(() => parseMethodParams("notes.assets.reserve", { path: { noteID: "note-a" }, body: { ...body, ...patch } })).toThrow();
  for (const url of ["http://storage.example/a", "https://user:secret@storage.example/a", "https://storage.example/a#fragment"])
    expect(() => parseMethodResult("notes.assets.download", { ...body, url, expires_at: "2099-01-01T00:00:00Z" })).toThrow();
});
it("closes a partially uploaded SDK asset handle when the transport fails", async () => {
  const handle = crypto.randomUUID();
  const request = vi.fn(async (message: { method: string }) => {
    if (message.method === "journal.assets.begin") return { handle };
    if (message.method === "journal.assets.write") throw new Error("failed chunk");
    return undefined;
  });
  const sdk = createMistyAppSDK({ request });
  await expect(sdk.journal.assets.upload({ resource: "drawing", resourceId: "drawing-a", externalFileId: "file-a", filename: "a.png", file: new Blob(["abc"], { type: "image/png" }) })).rejects.toThrow("failed chunk");
  expect(request).toHaveBeenLastCalledWith({ method: "journal.assets.close", params: { handle } });
  expect(request.mock.calls.some(([message]) => message.method === "journal.assets.commit")).toBe(false);
});
