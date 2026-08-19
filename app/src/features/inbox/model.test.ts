import type { MailThread } from "@/api/mail";
import { describe, expect, it } from "vitest";
import { mergeThreads, normalizeThread, parseAddressList, unifiedThreads } from "./model";

function thread(id: string, date: string, subject = " Subject "): MailThread {
  return {
    provider: "gmail",
    provider_id: id,
    account_id: "google-1",
    subject,
    snippet: "Preview",
    participants: [{ email: "sender@example.com" }],
    labels: ["INBOX"],
    last_message_at: date,
    unread: true,
    starred: false,
    messages: [],
  };
}

describe("Inbox normalization", () => {
  it("creates provider-safe keys and a usable empty subject", () => {
    expect(
      normalizeThread(thread("thread-1", "2026-01-01T00:00:00Z", " "), "connection-a"),
    ).toMatchObject({
      key: "connection-a:thread-1",
      connectionId: "connection-a",
      subject: "(no subject)",
    });
  });

  it("merges account results in newest-first order", () => {
    const older = normalizeThread(thread("old", "2026-01-01T00:00:00Z"), "connection-a");
    const newer = normalizeThread(thread("new", "2026-02-01T00:00:00Z"), "connection-b");
    expect(unifiedThreads({ a: [older], b: [newer] }).map((item) => item.provider_id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("parses comma and semicolon separated recipients", () => {
    expect(parseAddressList("a@example.com; b@example.com, c@example.com")).toEqual([
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "c@example.com" },
    ]);
  });

  it("de-duplicates a provider thread repeated on the next page", () => {
    const first = normalizeThread(thread("same", "2026-01-01T00:00:00Z"), "connection-a");
    const updated = normalizeThread(
      thread("same", "2026-02-01T00:00:00Z", "Updated"),
      "connection-a",
    );
    expect(mergeThreads([first], [updated])).toEqual([updated]);
  });
});
