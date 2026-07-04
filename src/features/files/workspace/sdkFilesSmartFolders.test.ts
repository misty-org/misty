import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkFilesSmartFolders } from "./sdkFilesSmartFolders";

it("preserves separate views' saved searches through scoped SDK records and deletion", async () => {
  const data = new Map<string, unknown>();
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    const input = params as { key: string; value: unknown };
    if (method === "lifecycle.ready") return;
    if (method === "storage.local.keys") return [...data.keys()];
    if (method === "storage.local.get") return structuredClone(data.get(input.key) ?? null);
    if (method === "storage.local.set") {
      data.set(input.key, structuredClone(input.value));
      return;
    }
    if (method === "storage.local.delete") {
      data.delete(input.key);
      return;
    }
    throw new Error(`Unexpected method ${method}`);
  });
  const misty = createMistyAppSDK({ request }),
    lifetime = new AbortController(),
    openSearch = vi.fn();
  const first = createSdkFilesSmartFolders(misty, lifetime.signal, openSearch);
  const second = createSdkFilesSmartFolders(misty, lifetime.signal, openSearch);
  const a = { id: "smart_a", name: "Images", query: "ext:png", rules: [], updatedAtMs: 1 };
  const b = { id: "smart_b", name: "Documents", query: "ext:pdf", rules: [], updatedAtMs: 2 };
  await Promise.all([first.services.save(a), second.services.save(b)]);
  const reopened = createSdkFilesSmartFolders(misty, lifetime.signal, openSearch);
  expect((await reopened.services.snapshot()).searches).toEqual(expect.arrayContaining([a, b]));
  expect((await first.services.delete(a.id)).searches).toEqual([b]);
  await reopened.services.openSearch("chosen-folder", b.query);
  expect(openSearch).toHaveBeenCalledWith("chosen-folder", "ext:pdf");
  lifetime.abort();
  await expect(second.services.save(a)).rejects.toThrow("closed");
  expect(data.size).toBe(1);
});
