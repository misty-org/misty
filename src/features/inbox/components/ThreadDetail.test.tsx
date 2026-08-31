import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxThread } from "../model";
import { ThreadDetail } from "./ThreadDetail";

describe("ThreadDetail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("renders email body with markdown formatting and clickable links when plaintext", async () => {
    const thread: InboxThread = {
      connectionId: "conn-1",
      key: "conn-1:thread-1",
      provider: "gmail",
      provider_id: "thread-1",
      account_id: "acc-1",
      subject: "Special Offer",
      snippet: "Check out this deal",
      participants: [{ name: "Grubhub", email: "deals@example.com" }],
      labels: ["INBOX"],
      last_message_at: "2026-08-19T10:00:00Z",
      unread: false,
      starred: false,
      messages: [
        {
          provider: "gmail",
          provider_id: "msg-1",
          account_id: "acc-1",
          thread_id: "thread-1",
          subject: "Special Offer",
          from: { name: "Grubhub", email: "deals@example.com" },
          to: [{ name: "Alex", email: "alex@example.com" }],
          cc: [],
          bcc: [],
          reply_to: [],
          sent_at: "2026-08-19T10:00:00Z",
          snippet: "Check out this deal",
          body: {
            text: "# Great Savings\n\n**20% off** your order.\n\nVisit https://example.com/deals today!",
            had_html: false,
            truncated: false,
          },
          labels: ["INBOX"],
          unread: false,
          starred: false,
          draft: false,
          attachments: [],
        },
      ],
    };

    await act(async () => {
      root.render(
        <ThreadDetail
          thread={thread}
          loading={false}
          actioning={false}
          onAction={vi.fn()}
          onReply={vi.fn()}
          onBack={vi.fn()}
        />,
      );
    });

    const heading = document.querySelector("h1");
    expect(heading?.textContent).toBe("Great Savings");

    const bold = document.querySelector("strong");
    expect(bold?.textContent).toBe("20% off");

    const link = document.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/deals");
    expect(link?.textContent).toBe("https://example.com/deals");
  });

  it("renders sandboxed iframe when html body is available", async () => {
    const thread: InboxThread = {
      connectionId: "conn-1",
      key: "conn-1:thread-2",
      provider: "outlook",
      provider_id: "thread-2",
      account_id: "acc-2",
      subject: "Welcome to Space",
      snippet: "Make Space part of your workflow",
      participants: [{ name: "Jason", email: "jason@fromspace.so" }],
      labels: ["INBOX"],
      last_message_at: "2026-08-19T10:00:00Z",
      unread: false,
      starred: false,
      messages: [
        {
          provider: "outlook",
          provider_id: "msg-2",
          account_id: "acc-2",
          thread_id: "thread-2",
          subject: "Welcome to Space",
          from: { name: "Jason", email: "jason@fromspace.so" },
          to: [{ name: "Matt", email: "matt@example.com" }],
          cc: [],
          bcc: [],
          reply_to: [],
          sent_at: "2026-08-19T10:00:00Z",
          snippet: "Make Space part of your workflow",
          body: {
            text: "Make Space part of your workflow.\nJason here.",
            html: `<div style="background:#000;color:#fff;"><h1>Make Space</h1><p>Jason here.</p><a href="https://fromspace.so">Get Space</a></div>`,
            had_html: true,
            truncated: false,
          },
          labels: ["INBOX"],
          unread: false,
          starred: false,
          draft: false,
          attachments: [],
        },
      ],
    };

    await act(async () => {
      root.render(
        <ThreadDetail
          thread={thread}
          loading={false}
          actioning={false}
          onAction={vi.fn()}
          onReply={vi.fn()}
          onBack={vi.fn()}
        />,
      );
    });

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin allow-popups");
    expect(iframe?.getAttribute("srcdoc")).toContain("Make Space");
    expect(iframe?.getAttribute("srcdoc")).toContain("https://fromspace.so");

    // Check view switcher buttons
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    const plainTextBtn = buttons.find((b) => b.textContent?.includes("Plain text"));
    expect(plainTextBtn).toBeDefined();

    // Click plain text switcher
    await act(async () => {
      plainTextBtn?.click();
    });

    expect(document.querySelector("iframe")).toBeNull();
    expect(document.body.textContent).toContain("Make Space part of your workflow.");
  });

  it("supports reply, reply-all, forward, AI summarization, and workspace actions", async () => {
    const onReply = vi.fn();
    const onConvertToTask = vi.fn();
    const onClipToJournal = vi.fn();

    const sampleThread: InboxThread = {
      connectionId: "conn-1",
      key: "conn-1:thread-3",
      provider: "gmail",
      provider_id: "thread-3",
      account_id: "acc-1",
      subject: "Sprint Planning Notes",
      snippet: "Action items for next sprint",
      participants: [{ name: "Sarah", email: "sarah@example.com" }],
      labels: ["INBOX"],
      last_message_at: "2026-08-20T10:00:00Z",
      unread: false,
      starred: false,
      messages: [
        {
          provider: "gmail",
          provider_id: "msg-3",
          account_id: "acc-1",
          thread_id: "thread-3",
          subject: "Sprint Planning Notes",
          from: { name: "Sarah", email: "sarah@example.com" },
          to: [{ name: "Team", email: "team@example.com" }],
          cc: [],
          bcc: [],
          reply_to: [],
          sent_at: "2026-08-20T10:00:00Z",
          snippet: "Action items for next sprint",
          body: {
            text: "Sprint goals:\n1. Launch inbox v2\n2. AI integration",
            had_html: false,
            truncated: false,
          },
          labels: ["INBOX"],
          unread: false,
          starred: false,
          draft: false,
          attachments: [],
        },
      ],
    };

    await act(async () => {
      root.render(
        <ThreadDetail
          thread={sampleThread}
          accounts={[
            {
              connection_id: "conn-1",
              provider: "gmail",
              account_id: "acc-1",
              email: "alex@example.com",
              display_name: "Alex",
              total: 1,
              unread: 0,
            },
          ]}
          loading={false}
          actioning={false}
          onAction={vi.fn()}
          onReply={onReply}
          onConvertToTask={onConvertToTask}
          onClipToJournal={onClipToJournal}
          onBack={vi.fn()}
        />,
      );
    });

    // Check action buttons in header
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];

    // Click Summarize button
    const summarizeBtn = buttons.find((b) => b.textContent?.includes("Summarize"));
    expect(summarizeBtn).toBeDefined();
    await act(async () => {
      summarizeBtn?.click();
    });

    // Click Turn into Task
    const taskBtn = document.querySelector(
      'button[aria-label="Turn into Task"]',
    ) as HTMLButtonElement;
    expect(taskBtn).not.toBeNull();
    await act(async () => {
      taskBtn?.click();
    });
    expect(onConvertToTask).toHaveBeenCalledWith(sampleThread);

    // Click Clip to Journal
    const journalBtn = document.querySelector(
      'button[aria-label="Clip to Journal"]',
    ) as HTMLButtonElement;
    expect(journalBtn).not.toBeNull();
    await act(async () => {
      journalBtn?.click();
    });
    expect(onClipToJournal).toHaveBeenCalledWith(sampleThread);

    // Click Reply All button
    const replyAllBtn = document.querySelector(
      'button[aria-label="Reply all"]',
    ) as HTMLButtonElement;
    expect(replyAllBtn).not.toBeNull();
    await act(async () => {
      replyAllBtn?.click();
    });
    expect(onReply).toHaveBeenCalledWith("replyAll");

    // Click Forward button
    const forwardBtn = document.querySelector('button[aria-label="Forward"]') as HTMLButtonElement;
    expect(forwardBtn).not.toBeNull();
    await act(async () => {
      forwardBtn?.click();
    });
    expect(onReply).toHaveBeenCalledWith("forward");
  });
});
