import type { MailThread } from "@/api/mail";
import { describe, expect, it } from "vitest";
import {
  mergeThreads,
  normalizeThread,
  parseAddressList,
  prepareReplyDraft,
  unifiedThreads,
} from "./model";

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

  it("prepares reply, reply-all, and forward drafts with proper recipients and subjects", () => {
    const t = normalizeThread(
      {
        ...thread("th-1", "2026-01-01T00:00:00Z", "Project Update"),
        messages: [
          {
            provider: "gmail",
            provider_id: "m-1",
            account_id: "google-1",
            thread_id: "th-1",
            subject: "Project Update",
            from: { name: "Alice", email: "alice@example.com" },
            to: [
              { name: "Bob", email: "bob@example.com" },
              { name: "Me", email: "me@example.com" },
            ],
            cc: [{ name: "Charlie", email: "charlie@example.com" }],
            bcc: [],
            reply_to: [],
            sent_at: "2026-01-01T00:00:00Z",
            snippet: "Status is green",
            body: { text: "Status is green and ready.", had_html: false, truncated: false },
            labels: ["INBOX"],
            unread: false,
            starred: false,
            draft: false,
            attachments: [],
          },
        ],
      },
      "conn-1",
    );

    // Reply
    const replyDraft = prepareReplyDraft(t, "me@example.com", "reply");
    expect(replyDraft.to).toBe("Alice");
    expect(replyDraft.subject).toBe("Re: Project Update");

    // Reply All
    const replyAllDraft = prepareReplyDraft(t, "me@example.com", "replyAll");
    expect(replyAllDraft.to).toBe("Alice, Bob");
    expect(replyAllDraft.cc).toBe("Charlie");
    expect(replyAllDraft.subject).toBe("Re: Project Update");

    // Forward
    const forwardDraft = prepareReplyDraft(t, "me@example.com", "forward");
    expect(forwardDraft.to).toBe("");
    expect(forwardDraft.subject).toBe("Fwd: Project Update");
    expect(forwardDraft.text).toContain("---------- Forwarded message ---------");
    expect(forwardDraft.text).toContain("Status is green and ready.");
  });
});
