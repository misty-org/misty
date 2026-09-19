import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
import { MISTY_TEXT_FILE_MAX_BYTES } from "@misty/contracts";

it("round trips a five MiB UTF-8 document through the SDK and normalizes native write replies", async () => {
  let contents = "";
  const request = vi.fn(async (input: { method: string; params?: unknown }) => {
    if (input.method === "files.writeText") {
      contents = (input.params as { text: string }).text;
      return null;
    }
    return { text: contents };
  });
  const files = createMistyAppSDK({ request }).files;
  const text = "🦀".repeat(MISTY_TEXT_FILE_MAX_BYTES / 4);
  await expect(files.writeText("owned", text)).resolves.toBeUndefined();
  expect(await files.readText("owned")).toBe(text);
  await files.writeText("owned", "");
  expect(await files.readText("owned")).toBe("");
});

it("rejects oversized Unicode writes and invalid handles before transport", async () => {
  const request = vi.fn(async () => null);
  const files = createMistyAppSDK({ request }).files;
  const initialCalls = request.mock.calls.length;
  await expect(
    files.writeText("owned", "🦀".repeat(MISTY_TEXT_FILE_MAX_BYTES / 4 + 1)),
  ).rejects.toThrow();
  await expect(
    files.writeText("owned", "a".repeat(MISTY_TEXT_FILE_MAX_BYTES + 1)),
  ).rejects.toThrow();
  await expect(files.writeText("", "text")).rejects.toThrow();
  await expect(files.readText("x".repeat(257))).rejects.toThrow();
  expect(request.mock.calls).toHaveLength(initialCalls);
});

it("rejects malformed and oversized device replies", async () => {
  const request = vi.fn(async (): Promise<unknown> => ({ text: 42 }));
  const files = createMistyAppSDK({ request }).files;
  await expect(files.readText("owned")).rejects.toThrow();
  request.mockResolvedValueOnce({
    text: "é".repeat(MISTY_TEXT_FILE_MAX_BYTES / 2 + 1),
  });
  await expect(files.readText("owned")).rejects.toThrow();
  request.mockResolvedValueOnce({ text: "ok", path: "/private/file" });
  await expect(files.readText("owned")).rejects.toThrow();
  request.mockResolvedValueOnce({ ok: false });
  await expect(files.writeText("owned", "text")).rejects.toThrow();
});
