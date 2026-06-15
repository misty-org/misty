import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { pickSdkInboxFiles } from "./sdkInboxFiles";
it("reads attachment chunks through SDK handles and releases them", async () => {
  const request = vi.fn(async (input: { method: string; params?: unknown }): Promise<unknown> => {
    if (input.method === "files.pickMany")
      return [{ handle: "file", name: "Fixture.pdf", bytes: 65539 }];
    if (input.method === "files.readBytes")
      return new Uint8Array((input.params as { length: number }).length).buffer;
  });
  const files = await pickSdkInboxFiles(
    createMistyAppSDK({ request }),
    new AbortController().signal,
  );
  expect(files[0]).toMatchObject({ name: "Fixture.pdf", type: "application/pdf", size: 65539 });
  expect(request).toHaveBeenCalledWith({
    method: "files.readBytes",
    params: { handle: "file", offset: 65536, length: 3 },
  });
  expect(request).toHaveBeenLastCalledWith({ method: "files.release", params: { handle: "file" } });
});
it("rejects oversized attachments before reading and releases the picked capability", async () => {
  const request = vi.fn(async (input: { method: string }): Promise<unknown> =>
    input.method === "files.pickMany"
      ? [{ handle: "large", name: "large.zip", bytes: 11 * 1024 * 1024 }]
      : undefined,
  );
  await expect(
    pickSdkInboxFiles(createMistyAppSDK({ request }), new AbortController().signal),
  ).rejects.toThrow("10 MiB");
  expect(request.mock.calls.some(([input]) => input.method === "files.readBytes")).toBe(false);
  expect(request).toHaveBeenLastCalledWith({
    method: "files.release",
    params: { handle: "large" },
  });
});
