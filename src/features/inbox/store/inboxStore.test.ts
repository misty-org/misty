import type { mailApi, MailThread } from "@/api/mail";
import { expect, it, vi } from "vitest";
import { normalizeThread } from "../model";
import {
  createInboxStoreWithRuntime,
  disposeInboxStore,
  type InboxStoreRuntime,
} from "./inboxStore";
const thread: MailThread = {
  provider: "google",
  provider_id: "thread",
  account_id: "mail",
  subject: "Summary",
  snippet: "",
  participants: [],
  labels: [],
  last_message_at: "2026-09-05T00:00:00Z",
  unread: false,
  starred: false,
  messages: [],
};
function runtime(api: Partial<typeof mailApi>): InboxStoreRuntime {
  return {
    api: api as typeof mailApi,
    readCache: async () => null,
    persist: vi.fn(),
    prefetchHtml: vi.fn(),
    errorMessage: (_code, fallback) => fallback,
  };
}
it("two Inbox stores do not share in-flight details even when provider IDs match", async () => {
  let resolveA!: (value: { thread: MailThread }) => void,
    resolveB!: (value: { thread: MailThread }) => void;
  const a = runtime({
    thread: vi.fn(
      () =>
        new Promise<{ thread: MailThread }>((resolve) => {
          resolveA = resolve;
        }),
    ),
  });
  const b = runtime({
    thread: vi.fn(
      () =>
        new Promise<{ thread: MailThread }>((resolve) => {
          resolveB = resolve;
        }),
    ),
  });
  const first = createInboxStoreWithRuntime(a),
    second = createInboxStoreWithRuntime(b);
  first.getState().setAccount("account-a");
  second.getState().setAccount("account-b");
  const openingA = first.getState().openThread(normalizeThread(thread, "same-connection"));
  const openingB = second.getState().openThread(normalizeThread(thread, "same-connection"));
  expect(a.api.thread).toHaveBeenCalledTimes(1);
  expect(b.api.thread).toHaveBeenCalledTimes(1);
  resolveA({ thread: { ...thread, subject: "Account A" } });
  resolveB({ thread: { ...thread, subject: "Account B" } });
  await Promise.all([openingA, openingB]);
  expect(first.getState().selectedThread?.subject).toBe("Account A");
  expect(second.getState().selectedThread?.subject).toBe("Account B");
  disposeInboxStore(first);
  disposeInboxStore(second);
});
it("closing an Inbox store discards pending details and releases prefetch ownership", async () => {
  let complete!: (value: { thread: MailThread }) => void;
  const backend = runtime({
    thread: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const lifetime = new AbortController();
  const store = createInboxStoreWithRuntime({ ...backend, signal: lifetime.signal });
  store.getState().setAccount("account-a");
  const pending = store.getState().openThread(normalizeThread(thread, "connection"));
  lifetime.abort();
  complete({ thread: { ...thread, subject: "Too late" } });
  await pending;
  expect(store.getState().selectedThread).toBeNull();
  expect(backend.persist).not.toHaveBeenCalled();
  expect(backend.prefetchHtml).not.toHaveBeenCalled();
});
it("a send completion cannot refresh a different account after switching accounts", async () => {
  let complete!: () => void;
  const backend = runtime({
    sendDraft: () =>
      new Promise((resolve) => {
        complete = () => resolve({ message: {} as never });
      }),
    threads: vi.fn(),
  });
  const store = createInboxStoreWithRuntime(backend);
  store.getState().setAccount("account-a");
  const pending = store.getState().sendDraft("draft", "connection-a");
  store.getState().setAccount("account-b");
  complete();
  await expect(pending).rejects.toThrow("account changed");
  expect(backend.api.threads).not.toHaveBeenCalled();
  expect(backend.persist).not.toHaveBeenCalled();
  disposeInboxStore(store);
});
