import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkInboxRuntime } from "./sdkInboxRuntime";

it("loads the existing Inbox store through real SDK mail and encrypted-cache contracts", async () => {
  const request = vi.fn(async (input: { method: string; params?: unknown }) => {
    switch (input.method) {
      case "lifecycle.ready":
      case "mail.cache.write":
        return;
      case "mail.cache.read":
        return null;
      case "mail.accounts.list":
        return {
          accounts: [
            {
              connection_id: "connection-a",
              provider: "google",
              account_id: "mailbox",
              email: "fixture@example.invalid",
              display_name: "Fixture",
              total: 0,
              unread: 0,
            },
          ],
        };
      case "mail.folders.list":
        return { folders: [] };
      case "mail.threads.list":
        return { threads: [] };
      default:
        throw new Error(`Unexpected Inbox request: ${input.method}`);
    }
  });
  const parent = new AbortController();
  const report = vi.fn();
  const runtime = createSdkInboxRuntime({
    misty: createMistyAppSDK({ request }),
    userId: "account-a",
    signal: parent.signal,
    prefetchHtml: vi.fn(),
    report,
  });
  await runtime.store.getState().load();
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "mail.cache.write" })),
  );
  expect(runtime.store.getState()).toMatchObject({
    accountId: "account-a",
    loaded: true,
    error: null,
  });
  expect(runtime.store.getState().accounts[0].connection_id).toBe("connection-a");
  expect(report).not.toHaveBeenCalled();
  const requests = request.mock.calls.length;
  parent.abort();
  expect(runtime.store.getState().accounts).toEqual([]);
  await runtime.store.getState().load();
  expect(request).toHaveBeenCalledTimes(requests);
  runtime.close();
});
