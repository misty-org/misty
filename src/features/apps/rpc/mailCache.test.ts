import { webcrypto } from "node:crypto";
import { createMistyAppSDK, type MailCacheData } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createAppRpcScope } from "./session";
import { createMailCacheRpc, type MailCacheBackend } from "./mailCache";
const data: MailCacheData = {
  accounts: [],
  foldersByConnection: {},
  threadsByConnection: {},
  nextPageByConnection: {},
  estimatedTotalByConnection: {},
  detailFetchedAtByThread: {},
};
const allScopes = ["mail.read", "storage.read", "storage.write"];
function fixture(
  overrides: {
    accountId?: string;
    appId?: string;
    spaceId?: string;
    serverBase?: string;
    scopes?: string[];
  } = {},
) {
  const storage = new Map<string, string>();
  const scope = createAppRpcScope({
    identity: {
      accountId: overrides.accountId ?? "account-a",
      appId: overrides.appId ?? "inbox",
      spaceId: overrides.spaceId ?? "space-a",
      instanceId: crypto.randomUUID(),
    },
    scopes: overrides.scopes ?? allScopes,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isCurrentAccount: () => true,
  });
  const backend: MailCacheBackend = {
    serverBase: overrides.serverBase ?? "https://one.example.invalid/api",
    crypto: webcrypto as Crypto,
    readSecret: vi.fn(async () => "secret-token-a"),
    read: vi.fn(async (key) => storage.get(key) ?? null),
    write: vi.fn(async (key, value) => {
      storage.set(key, value);
    }),
    remove: vi.fn(async (key) => {
      storage.delete(key);
    }),
  };
  const rpc = createMailCacheRpc(scope, backend);
  const sdk = createMistyAppSDK({
    request: (input) =>
      input.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(input),
  });
  return { storage, scope, backend, rpc, cache: sdk.mail.cache };
}
it("stores ciphertext and returns only the calling account's validated cache", async () => {
  const test = fixture();
  try {
    await test.cache.write(data);
    const [key, value] = [...test.storage.entries()][0];
    expect(key).toMatch(/^sdk-mail-v1-[a-f0-9]{64}$/);
    expect(value).not.toContain("account-a");
    expect(value).not.toContain("secret-token-a");
    expect(value).not.toContain("threadsByConnection");
    expect(await test.cache.read()).toMatchObject({ version: 2, accountId: "account-a", data });
    await test.cache.clear();
    expect(await test.cache.read()).toBeNull();
  } finally {
    test.scope.close();
  }
});
it("separates accounts, deployments, Apps and Spaces, and rejects copied ciphertext", async () => {
  const original = fixture();
  try {
    await original.cache.write(data);
    const [originalKey, encrypted] = [...original.storage.entries()][0];
    for (const options of [
      { accountId: "account-b" },
      { serverBase: "https://two.example.invalid/api" },
      { appId: "another-mail-app" },
      { spaceId: "space-b" },
    ]) {
      const other = fixture(options);
      try {
        await other.cache.write(data);
        const key = [...other.storage.keys()][0];
        expect(key).not.toBe(originalKey);
        other.storage.set(key, encrypted);
        expect(await other.cache.read()).toBeNull();
      } finally {
        other.scope.close();
      }
    }
  } finally {
    original.scope.close();
  }
});
it("denies missing grants before reading credentials or native storage", async () => {
  const test = fixture({ scopes: ["mail.read"] });
  try {
    await expect(test.cache.read()).rejects.toThrow("storage.read");
    await expect(test.cache.write(data)).rejects.toThrow("storage.write");
    expect(test.backend.readSecret).not.toHaveBeenCalled();
    expect(test.backend.read).not.toHaveBeenCalled();
  } finally {
    test.scope.close();
  }
});
it("cancels a queued write when the account closes during key acquisition", async () => {
  const test = fixture();
  let resolve!: (value: string) => void;
  test.backend.readSecret = vi.fn(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const pending = test.cache.write(data);
  await vi.waitFor(() => expect(test.backend.readSecret).toHaveBeenCalled());
  test.scope.close();
  resolve("secret-token-a");
  await expect(pending).rejects.toThrow("closed");
  expect(test.backend.write).not.toHaveBeenCalled();
  await expect(test.cache.clear()).rejects.toThrow("closed");
});
