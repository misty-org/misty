import type { InboxThread } from "../model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistInboxCache, readInboxCache } from "./inboxCache";

const native = vi.hoisted(() => ({
  value: null as string | null,
  read: vi.fn(async () => native.value),
  write: vi.fn(async (_accountId: string, value: string) => {
    native.value = value;
  }),
  remove: vi.fn(async () => {
    native.value = null;
  }),
}));

vi.mock("@/native/runtime", () => ({
  mailCacheRead: native.read,
  mailCacheWrite: native.write,
  mailCacheRemove: native.remove,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/client/session", () => ({
  readApiAuthToken: async () => "test-auth-token",
}));

describe("Inbox disk cache", () => {
  beforeEach(() => {
    native.value = null;
    native.read.mockClear();
    native.write.mockClear();
    native.remove.mockClear();
  });

  it("encrypts cached mail and restores it for the same Misty account", async () => {
    const cachedThread: InboxThread = {
      provider: "gmail",
      provider_id: "thread-1",
      account_id: "provider-account",
      connectionId: "connection-1",
      key: "connection-1:thread-1",
      subject: "Private subject",
      snippet: "Private preview",
      participants: [{ email: "sender@example.com" }],
      labels: ["INBOX"],
      last_message_at: "2026-08-19T12:00:00Z",
      unread: true,
      starred: false,
      messages: [],
    };
    persistInboxCache("misty-account", {
      accounts: [],
      foldersByConnection: {},
      threadsByConnection: { "connection-1": [cachedThread] },
      nextPageByConnection: {},
      estimatedTotalByConnection: { "connection-1": 1 },
      detailFetchedAtByThread: {},
    });

    await vi.waitFor(() => expect(native.write).toHaveBeenCalledOnce());
    expect(native.value).not.toContain("Private subject");
    await expect(readInboxCache("misty-account")).resolves.toMatchObject({
      accountId: "misty-account",
      threadsByConnection: { "connection-1": [{ subject: "Private subject" }] },
    });
  });
});
