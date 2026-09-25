import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkDrawingInterop } from "./sdkDrawingInterop";

it("uses native SDK clipboard image/text methods for the drawing library actions", async () => {
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => {
    if (message.method === "clipboard.readImage") return { mimeType: "image/png", data: "AAH/" };
    if (message.method === "clipboard.readText") return { text: "Canvas text" };
    return undefined;
  });
  const abort = new AbortController();
  const adapter = createSdkDrawingInterop(createMistyAppSDK({ request }), abort.signal);
  const pasted = await adapter.readSystemClipboard();
  expect(pasted["image/png"]).toBeInstanceOf(File);
  expect(await (pasted["image/png"] as File).arrayBuffer()).toEqual(
    new Uint8Array([0, 1, 255]).buffer,
  );
  await adapter.copyBlobToClipboardAsPng(Promise.resolve(pasted["image/png"] as File));
  expect(request).toHaveBeenCalledWith({
    method: "clipboard.writeImage",
    params: { mimeType: "image/png", data: "AAH/" },
  });
  await adapter.copyTextToSystemClipboard("Scene JSON");
  expect(request).toHaveBeenCalledWith({
    method: "clipboard.writeText",
    params: { text: "Scene JSON" },
  });
  request.mockImplementation(async (message) =>
    message.method === "clipboard.readImage"
      ? null
      : message.method === "clipboard.readText"
        ? { text: "Canvas text" }
        : undefined,
  );
  expect(await adapter.readSystemClipboard()).toEqual({ "text/plain": "Canvas text" });
  abort.abort();
  await expect(adapter.copyTextToSystemClipboard("late")).rejects.toThrow("cancelled");
});
it("opens an Excalidraw file using bounded native reads and releases every selected capability", async () => {
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => {
    if (message.method === "files.pick")
      return { handle: "file", name: "Map.excalidraw", bytes: 3 };
    if (message.method === "files.readBytes") return new Uint8Array([123, 125, 32]).buffer;
    return undefined;
  });
  const adapter = createSdkDrawingInterop(
    createMistyAppSDK({ request }),
    new AbortController().signal,
  );
  const file = (await adapter.fileOpen({ extensions: ["excalidraw"] })) as File;
  expect(file.name).toBe("Map.excalidraw");
  expect(file.type).toBe("application/vnd.excalidraw+json");
  expect(await file.text()).toBe("{} ");
  expect(request).toHaveBeenLastCalledWith({ method: "files.release", params: { handle: "file" } });
});
it("does not fall back to browser access after a rejected grant, and does not report a cancelled save as success", async () => {
  const request = vi.fn(async (message: { method: string }): Promise<unknown> => {
    if (message.method === "files.pickDirectory") return null;
    if (message.method === "clipboard.writeText") throw new Error("Device grant denied");
    return undefined;
  });
  const adapter = createSdkDrawingInterop(
    createMistyAppSDK({ request }),
    new AbortController().signal,
  );
  await expect(adapter.copyTextToSystemClipboard("Scene JSON")).rejects.toThrow(
    "Device grant denied",
  );
  await expect(
    adapter.fileSave(new Blob(["{}"]), { name: "Scene", extension: "excalidraw" }),
  ).rejects.toThrow("cancelled");
  expect(
    request.mock.calls.filter(([message]) => message.method === "files.createCopy"),
  ).toHaveLength(0);
});
