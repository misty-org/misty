import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkInboxServices } from "./inboxServices";

it("maps Inbox listing, search and actions to named SDK methods with provider IDs unchanged", async () => {
  const request = vi.fn(async (input: { method: string; params?: unknown }) => {
    if (input.method === "mail.accounts.list") return { accounts: [] };
    if (input.method === "mail.threads.list") return { threads: [], next_page_token: "next" };
    if (input.method === "mail.threads.action")
      return { thread_id: "AA+/%2F==", added_labels: [], removed_labels: [] };
  });
  const service = createSdkInboxServices(
    createMistyAppSDK({ request }),
    new AbortController().signal,
  );
  expect(await service.accounts()).toEqual({ accounts: [] });
  expect(
    await service.threads({
      connectionId: "connection-a",
      folderId: "Inbox",
      query: "from:fixture",
      pageToken: "previous",
    }),
  ).toEqual({ threads: [], next_page_token: "next" });
  expect(request).toHaveBeenCalledWith({
    method: "mail.threads.list",
    params: {
      query: {
        connection_id: "connection-a",
        folder_id: "Inbox",
        query: "from:fixture",
        page_token: "previous",
        page_size: 40,
      },
    },
  });
  await service.actOnThread("AA+/%2F==", { connection_id: "connection-a", read: false });
  expect(request).toHaveBeenCalledWith({
    method: "mail.threads.action",
    params: {
      path: { threadID: "AA+/%2F==" },
      body: { connection_id: "connection-a", read: false },
    },
  });
  await expect(
    service.actOnThread("thread", { connection_id: "connection-a", deleted: true }),
  ).rejects.toThrow();
});
it("discards replies after view closure and never starts late requests", async () => {
  let complete!: (value: unknown) => void;
  const request = vi.fn((input: { method: string }): Promise<unknown> =>
    input.method === "mail.accounts.list"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve(),
  );
  const lifetime = new AbortController();
  const service = createSdkInboxServices(createMistyAppSDK({ request }), lifetime.signal);
  const pending = service.accounts();
  lifetime.abort();
  complete({ accounts: [] });
  await expect(pending).rejects.toThrow("closed");
  await expect(service.accounts()).rejects.toThrow("closed");
  expect(
    request.mock.calls.filter(([input]) => input.method === "mail.accounts.list"),
  ).toHaveLength(1);
});
