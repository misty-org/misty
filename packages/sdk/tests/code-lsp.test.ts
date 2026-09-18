import { expect, it, vi } from "vitest";
import { createMistyAppSDK, type MistyLspLanguage } from "@misty/sdk";
it("uses typed language-server requests and validates event envelopes", async () => {
  const request = vi.fn(async ({ method }: { method: string }) =>
    method === "code.lsp.start" ? { handle: "owned" } : null,
  );
  let event: (event: unknown) => void = () => undefined;
  const remove = vi.fn();
  const subscribe = vi.fn(
    async (_topic: string, listener: (event: unknown) => void) => {
      event = listener;
      return remove;
    },
  );
  const sdk = createMistyAppSDK({ request, subscribe });
  expect(await sdk.code.lsp.start("cpp", "/tmp/project")).toEqual({
    handle: "owned",
  });
  const listener = vi.fn();
  expect(await sdk.code.lsp.subscribe("owned", listener)).toBe(remove);
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, result: null });
  event({ type: "message", payload });
  expect(listener).toHaveBeenCalledWith({ type: "message", payload });
  expect(() => event({ type: "message", payload: "null" })).toThrow();
  await sdk.code.lsp.send("owned", payload);
  expect(request).toHaveBeenLastCalledWith({
    method: "code.lsp.send",
    params: { handle: "owned", payload },
  });
  await expect(sdk.code.lsp.stop("owned")).resolves.toBeUndefined();
});
it("rejects unsupported commands, relative working folders and malformed messages before transport", async () => {
  const request = vi.fn(async () => null);
  const lsp = createMistyAppSDK({ request }).code.lsp;
  const initial = request.mock.calls.length;
  await expect(
    lsp.start("/bin/sh" as MistyLspLanguage, "/tmp"),
  ).rejects.toThrow();
  await expect(lsp.start("cpp", "relative")).rejects.toThrow();
  await expect(lsp.start("cpp", "/tmp\0suffix")).rejects.toThrow();
  await expect(lsp.send("owned", "[]")).rejects.toThrow();
  await expect(
    lsp.send("owned", "x".repeat(8 * 1024 * 1024 + 1)),
  ).rejects.toThrow();
  expect(request.mock.calls).toHaveLength(initial);
});
