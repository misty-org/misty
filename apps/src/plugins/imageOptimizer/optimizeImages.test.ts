import { afterEach, expect, it, vi } from "vitest";
import type { MistyAppSDK } from "@misty/sdk";
import { encodeImage, optimizeImages } from "./optimizeImages";
function fixture(size = 100_000) {
  const readBytes = vi.fn(async (_handle, offset, length) => new Uint8Array(Math.min(length, size-offset)).buffer);
  const files = { readBytes, createCopy: vi.fn(async () => ({handle:"draft"})), appendCopy: vi.fn(async () => undefined), commitCopy: vi.fn(async () => ({name:"photo_optimized.jpg", bytes:70_000})), discardCopy: vi.fn(async () => undefined) };
  return { files, sdk: { files } as unknown as MistyAppSDK, chosen: [{handle:"chosen", name:"photo.jpg",bytes:size}] };
}
it("reads and saves in bounded chunks using only native handles", async () => {
  const {files,sdk,chosen} = fixture();
  const result = await optimizeImages(sdk,chosen,"chosen-folder",{quality:"balanced",maxDimension:null},new AbortController().signal,vi.fn(),async input => {
    expect(input.size).toBe(100_000);
    return new Blob([new Uint8Array(70_000)],{type:"image/jpeg"});
  });
  expect(files.readBytes.mock.calls).toEqual([["chosen",0,65_536],["chosen",65_536,34_464]]);
  expect(files.createCopy).toHaveBeenCalledWith("chosen-folder","photo_optimized.jpg");
  expect(files.appendCopy.mock.calls.map(call => (call as unknown as [string,ArrayBuffer])[1].byteLength)).toEqual([65_536,4_464]);
  expect(files.commitCopy).toHaveBeenCalledWith("draft");
  expect(result).toMatchObject({originalBytes:100_000,outputBytes:70_000,files:[{status:"completed"}]});
});
it("cancellation while staging discards the draft without committing a copy", async () => {
  const {files,sdk,chosen} = fixture(); const abort = new AbortController();
  files.appendCopy.mockImplementationOnce(async () => { abort.abort(); });
  await expect(optimizeImages(sdk,chosen,"folder",{quality:"balanced",maxDimension:null},abort.signal,vi.fn(),async () => new Blob([new Uint8Array(70_000)],{type:"image/jpeg"}))).rejects.toThrow();
  expect(files.discardCopy).toHaveBeenCalledWith("draft");
  expect(files.commitCopy).not.toHaveBeenCalled();
});
it("a revoked write grant prevents commit and preserves the native error", async () => {
  const {files,sdk,chosen} = fixture();
  files.appendCopy.mockRejectedValueOnce(new Error("Permission was revoked"));
  const result = await optimizeImages(sdk,chosen,"folder",{quality:"balanced",maxDimension:null},new AbortController().signal,vi.fn(),async () => new Blob(["bytes"],{type:"image/jpeg"}));
  expect(result.files[0]).toMatchObject({status:"failed", message: "Error: Permission was revoked"});
  expect(files.commitCopy).not.toHaveBeenCalled(); expect(files.discardCopy).toHaveBeenCalledWith("draft");
});
it("rejects oversized inputs before reading and gives fallback encodings the correct extension", async () => {
  const {files,sdk,chosen} = fixture(100_000_000);
  const encode = vi.fn(async () => new Blob(["png"],{type:"image/png"}));
  const result = await optimizeImages(sdk,chosen,"folder",{quality:"balanced",maxDimension:1280},new AbortController().signal,vi.fn(),encode);
  expect(files.readBytes).not.toHaveBeenCalled(); expect(encode).not.toHaveBeenCalled();
  expect(result.files[0].message).toContain("64 MB");
  await optimizeImages(sdk,[{...chosen[0],bytes:3}],"folder",{quality:"balanced",maxDimension:1280},new AbortController().signal,vi.fn(),encode);
  expect(files.createCopy).toHaveBeenCalledWith("folder","photo_optimized.png");
});

afterEach(() => vi.unstubAllGlobals());
it("cancel interrupts an encoder that never returns and releases its image resources", async () => {
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: () => "blob:fixture", revokeObjectURL });
  vi.stubGlobal("window", { setTimeout });
  vi.stubGlobal("Image", class {
    naturalWidth = 100; naturalHeight = 100;
    onload?: () => void;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  });
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: vi.fn() };
  vi.stubGlobal("document", { createElement: () => canvas });
  const abort = new AbortController();
  const pending = encodeImage(new Blob(["fixture"],{type:"image/jpeg"}),{quality:"balanced",maxDimension:null},abort.signal);
  await vi.waitFor(() => expect(canvas.toBlob).toHaveBeenCalled());
  abort.abort();
  await expect(pending).rejects.toThrow("cancelled");
  expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
});
