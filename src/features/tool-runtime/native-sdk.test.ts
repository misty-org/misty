import { afterEach, expect, it, vi } from "vitest";
import { connectMistyApp } from "@misty/sdk";
afterEach(() => vi.unstubAllGlobals());
it("connects through the native capability transport without a parent frame", async () => {
  const request = vi
    .fn()
    .mockImplementation(async ({ method }) =>
      method === "clipboard.readText" ? { text: "Granted" } : null,
    );
  vi.stubGlobal("window", { mistyHost: { request } });
  const sdk = connectMistyApp();
  expect(await sdk.clipboard.readText()).toBe("Granted");
  await sdk.files.pick({ write: true });
  await sdk.files.pickDirectory();
  await sdk.files.pickDirectory({ write: true });
  await sdk.files.pickMany();
  await sdk.files.readBytes("chosen", 65536, 12);
  await sdk.files.createCopy("output-folder", "copy.png");
  await sdk.files.appendCopy("draft", new Uint8Array([0, 255]).buffer);
  await sdk.files.commitCopy("draft");
  await sdk.files.discardCopy("unused-draft");
  await sdk.files.release("previous-selection");
  expect(request).toHaveBeenCalledWith({ method: "files.pickDirectory", params: { write: true } });
  expect(request).toHaveBeenCalledWith({ method: "files.readBytes", params: { handle: "chosen", offset: 65536, length: 12 } });
  expect(request).toHaveBeenCalledWith({ method: "files.createCopy", params: { directory: "output-folder", name: "copy.png" } });
  expect(request).toHaveBeenCalledWith({ method: "files.commitCopy", params: { handle: "draft" } });
  expect(request).toHaveBeenCalledWith({ method: "files.release", params: { handle: "previous-selection" } });
  await sdk.files.scanStart("chosen-folder-handle");
  await sdk.files.scanCancel("owned-job");
  await sdk.media.status();
  await sdk.media.convertStart({handle:"chosen",directory:"folder",name:"copy.mp3",format:"mp3",quality:"balanced"});
  await sdk.media.convertCollect("conversion");
  await sdk.media.convertCancel("conversion");
  expect(request).toHaveBeenCalledWith({method:"media.convertCollect",params:{jobId:"conversion"}});
  expect(request).toHaveBeenCalledWith({method:"media.convertCancel",params:{jobId:"conversion"}});
  await sdk.appearance.preset("copper");
  await sdk.appearance.apply({ text: "#FFFFFF" }, "custom");
  expect(request).toHaveBeenCalledWith({ method: "appearance.preset", params: { preset: "copper", preview: true } });
  expect(request).toHaveBeenCalledWith({ method: "appearance.apply", params: { tokens: { text: "#FFFFFF" }, preset: "custom" } });
  await sdk.permissions.revoke("clipboard.read");
  expect(request).toHaveBeenCalledWith({
    method: "lifecycle.ready",
    params: {},
  });
  expect(request).toHaveBeenCalledWith({
    method: "files.pick",
    params: { write: true },
  });
  expect(request).toHaveBeenCalledWith({
    method: "permissions.revoke",
    params: { capability: "clipboard.read" },
  });
  expect(request).toHaveBeenCalledWith({ method: "files.scanStart", params: { handle: "chosen-folder-handle" } });
  expect(request).toHaveBeenCalledWith({ method: "files.scanCancel", params: { jobId: "owned-job" } });
});
it("fails clearly outside the native host", () => {
  vi.stubGlobal("window", {});
  expect(() => connectMistyApp()).toThrow("native App runtime");
});
