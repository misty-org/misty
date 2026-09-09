import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { exportSdkJournalFile } from "./sdkJournalExport";

it("writes a staged export in chunks, commits it and releases the selected directory", async () => {
  const request = vi.fn(async (message: { method: string }) => {
    if (message.method === "files.pickDirectory") return { handle: "folder", name: "Exports" };
    if (message.method === "files.createCopy") return { handle: "draft" };
    return undefined;
  });
  await exportSdkJournalFile(
    createMistyAppSDK({ request }),
    new AbortController().signal,
    new Blob([new Uint8Array(65537)]),
    "Sketch.png",
  );
  expect(
    request.mock.calls.filter(([message]) => message.method === "files.appendCopy"),
  ).toHaveLength(2);
  expect(request).toHaveBeenCalledWith({ method: "files.commitCopy", params: { handle: "draft" } });
  expect(request).toHaveBeenLastCalledWith({
    method: "files.release",
    params: { handle: "folder" },
  });
});
it("discards partial exports after closure without committing or writing the next chunk", async () => {
  const abort = new AbortController();
  const request = vi.fn(async (message: { method: string }) => {
    if (message.method === "files.pickDirectory") return { handle: "folder", name: "Exports" };
    if (message.method === "files.createCopy") return { handle: "draft" };
    if (message.method === "files.appendCopy") abort.abort();
    return undefined;
  });
  await exportSdkJournalFile(
    createMistyAppSDK({ request }),
    abort.signal,
    new Blob([new Uint8Array(65537)]),
    "Sketch.png",
  );
  expect(
    request.mock.calls.filter(([message]) => message.method === "files.appendCopy"),
  ).toHaveLength(1);
  expect(
    request.mock.calls.filter(([message]) => message.method === "files.commitCopy"),
  ).toHaveLength(0);
  expect(request).toHaveBeenCalledWith({
    method: "files.discardCopy",
    params: { handle: "draft" },
  });
  expect(request).toHaveBeenLastCalledWith({
    method: "files.release",
    params: { handle: "folder" },
  });
});
