import { expect, it, vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
import type { MailCacheData } from "@misty/contracts";
const data: MailCacheData = {
  accounts: [],
  foldersByConnection: {},
  threadsByConnection: {},
  nextPageByConnection: {},
  estimatedTotalByConnection: {},
  detailFetchedAtByThread: {},
};
it("uses the host-owned mail cache without caller-supplied account, path or key material", async () => {
  const snapshot = {
    version: 2,
    accountId: "account-a",
    savedAt: "2026-09-05T00:00:00Z",
    data,
  };
  const request = vi.fn(async (input: { method: string; params?: unknown }) =>
    input.method === "mail.cache.read" ? snapshot : undefined,
  );
  const cache = createMistyAppSDK({ request }).mail.cache;
  await cache.write(data);
  expect(await cache.read()).toEqual(snapshot);
  await cache.clear();
  expect(request).toHaveBeenCalledWith({
    method: "mail.cache.write",
    params: { data },
  });
  await expect(
    cache.write({ ...data, accountId: "another" } as never),
  ).rejects.toThrow();
  expect(
    request.mock.calls.filter(([input]) => input.method === "mail.cache.write"),
  ).toHaveLength(1);
});
