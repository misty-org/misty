import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxThread } from "../model";
import { ThreadList } from "./ThreadList";

describe("ThreadList component", () => {
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
    container.remove();
  });

  const sampleThread: InboxThread = {
    provider: "google",
    provider_id: "t-1",
    account_id: "acc-1",
    connectionId: "conn-1",
    key: "conn-1:t-1",
    subject: "Meeting Notes",
    snippet: "Summary of discussion",
    participants: [{ name: "Alice", email: "alice@example.com" }],
    labels: ["INBOX"],
    last_message_at: "2026-08-23T10:00:00Z",
    unread: true,
    starred: false,
    messages: [
      {
        provider: "google",
        provider_id: "m-1",
        account_id: "acc-1",
        thread_id: "t-1",
        subject: "Meeting Notes",
        from: { name: "Alice", email: "alice@example.com" },
        to: [{ name: "Bob", email: "bob@example.com" }],
        cc: [],
        bcc: [],
        reply_to: [],
        sent_at: "2026-08-23T10:00:00Z",
        snippet: "Summary of discussion",
        body: { text: "Discussion points", had_html: false, truncated: false },
        labels: ["INBOX"],
        unread: true,
        starred: false,
        draft: false,
        attachments: [
          {
            provider: "google",
            provider_id: "a-1",
            account_id: "acc-1",
            message_id: "m-1",
            filename: "notes.pdf",
            content_type: "application/pdf",
            size: 2048,
            inline: false,
          },
        ],
      },
      {
        provider: "google",
        provider_id: "m-2",
        account_id: "acc-1",
        thread_id: "t-1",
        subject: "Meeting Notes",
        from: { name: "Alice", email: "alice@example.com" },
        to: [{ name: "Bob", email: "bob@example.com" }],
        cc: [],
        bcc: [],
        reply_to: [],
        sent_at: "2026-08-23T11:00:00Z",
        snippet: "Follow up",
        body: { text: "Action items", had_html: false, truncated: false },
        labels: ["INBOX"],
        unread: true,
        starred: false,
        draft: false,
        attachments: [],
      },
    ],
  };

  it("renders search input, filter chips, and row indicators", async () => {
    const onSearch = vi.fn();
    const onOpen = vi.fn();
    const onAction = vi.fn();

    await act(async () => {
      root.render(
        <ThreadList
          accounts={[
            {
              connection_id: "conn-1",
              provider: "google",
              account_id: "acc-1",
              email: "bob@example.com",
              display_name: "Bob",
              total: 2,
              unread: 1,
            },
          ]}
          threads={[sampleThread]}
          totalCount={1}
          selectedKey=""
          loading={false}
          loadingMore={false}
          canLoadMore={false}
          onSearch={onSearch}
          onOpen={onOpen}
          onRefresh={() => undefined}
          onLoadMore={() => undefined}
          onAction={onAction}
        />,
      );
    });

    expect(container.querySelector('input[aria-label="Search mail"]')).not.toBeNull();
    expect(container.querySelector('button[data-filter-chip="all"]')).not.toBeNull();
    expect(container.querySelector('button[data-filter-chip="unread"]')).not.toBeNull();
    expect(container.querySelector('button[data-filter-chip="starred"]')).not.toBeNull();
    expect(container.querySelector('button[data-filter-chip="attachments"]')).not.toBeNull();

    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("Meeting Notes");
    // Thread message count pill
    expect(container.textContent).toContain("2");
    // Paperclip icon
    expect(container.querySelector('svg[aria-label="Has attachments"]')).not.toBeNull();

    // Hover action buttons
    expect(container.querySelector('button[title="Archive"]')).not.toBeNull();
    expect(container.querySelector('button[title="Mark read"]')).not.toBeNull();
    expect(container.querySelector('button[title="Delete"]')).not.toBeNull();
  });

  it("submits search when pressing Enter or submitting search form", async () => {
    const onSearch = vi.fn();

    await act(async () => {
      root.render(
        <ThreadList
          accounts={[]}
          threads={[]}
          totalCount={0}
          selectedKey=""
          loading={false}
          loadingMore={false}
          canLoadMore={false}
          onSearch={onSearch}
          onOpen={() => undefined}
          onRefresh={() => undefined}
          onLoadMore={() => undefined}
          onAction={() => undefined}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search mail"]')!;
    await act(async () => {
      input.value = "from:alice";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onSearch).toHaveBeenCalled();
  });

  it("triggers actions from row hover buttons", async () => {
    const onAction = vi.fn();

    await act(async () => {
      root.render(
        <ThreadList
          accounts={[]}
          threads={[sampleThread]}
          totalCount={1}
          selectedKey=""
          loading={false}
          loadingMore={false}
          canLoadMore={false}
          onOpen={() => undefined}
          onRefresh={() => undefined}
          onLoadMore={() => undefined}
          onAction={onAction}
        />,
      );
    });

    const archiveButton = container.querySelector<HTMLButtonElement>('button[title="Archive"]');
    await act(async () => archiveButton?.click());

    expect(onAction).toHaveBeenCalledWith(sampleThread, { archived: true });

    const markReadButton = container.querySelector<HTMLButtonElement>('button[title="Mark read"]');
    await act(async () => markReadButton?.click());

    expect(onAction).toHaveBeenCalledWith(sampleThread, { read: true });
  });

  it("fosters instant client-side fuzzy search as typing and triggers debounced search", async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    const thread2: InboxThread = {
      ...sampleThread,
      provider_id: "t-2",
      key: "conn-1:t-2",
      subject: "Pacsun Order Confirmation",
      snippet: "Your items have shipped",
      participants: [{ name: "Pacsun", email: "orders@pacsun.com" }],
    };

    await act(async () => {
      root.render(
        <ThreadList
          accounts={[]}
          threads={[sampleThread, thread2]}
          totalCount={2}
          selectedKey=""
          loading={false}
          loadingMore={false}
          canLoadMore={false}
          onSearch={onSearch}
          onOpen={() => undefined}
          onRefresh={() => undefined}
          onLoadMore={() => undefined}
          onAction={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain("Meeting Notes");
    expect(container.textContent).toContain("Pacsun Order Confirmation");

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search mail"]')!;
    // Type "pacsun"
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(input, "pacsun");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Client-side fuzzy filter immediately hides Meeting Notes and keeps Pacsun
    expect(container.textContent).not.toContain("Meeting Notes");
    expect(container.textContent).toContain("Pacsun Order Confirmation");

    // Server search has not been called immediately due to debounce
    expect(onSearch).not.toHaveBeenCalled();

    // Fast-forward debounce timer (300ms)
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(onSearch).toHaveBeenCalledWith("pacsun");
    vi.useRealTimers();
  });

  it("triggers fanned-out top bar actions for mark all read and unread", async () => {
    const onAction = vi.fn();
    const unreadThread: InboxThread = {
      ...sampleThread,
      unread: true,
    };
    const readThread: InboxThread = {
      ...sampleThread,
      provider_id: "t-read",
      key: "conn-1:t-read",
      unread: false,
    };

    await act(async () => {
      root.render(
        <ThreadList
          accounts={[]}
          threads={[unreadThread, readThread]}
          totalCount={2}
          selectedKey=""
          loading={false}
          loadingMore={false}
          canLoadMore={false}
          onOpen={() => undefined}
          onRefresh={() => undefined}
          onLoadMore={() => undefined}
          onAction={onAction}
        />,
      );
    });

    const markAllRead = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Mark all as read"]',
    );
    expect(markAllRead).not.toBeNull();
    await act(async () => markAllRead?.click());

    expect(onAction).toHaveBeenCalledWith(unreadThread, { read: true });

    const markAllUnread = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Mark all as unread"]',
    );
    expect(markAllUnread).not.toBeNull();
    await act(async () => markAllUnread?.click());

    expect(onAction).toHaveBeenCalledWith(readThread, { read: false });
  });

  it("displays only main sender and cc without recipient in row sender column", async () => {
    const threadWithCc: InboxThread = {
      ...sampleThread,
      participants: [
        { name: "Pacsun", email: "deals@pacsun.com" },
        { name: "Rewards", email: "rewards@pacsun.com" },
        { name: "mattdev727", email: "mattdev727@gmail.com" },
      ],
      messages: [
        {
          provider: "google",
          provider_id: "m-100",
          account_id: "acc-1",
          thread_id: "t-1",
          subject: "Sale",
          from: { name: "Pacsun", email: "deals@pacsun.com" },
          to: [{ name: "mattdev727", email: "mattdev727@gmail.com" }],
          cc: [{ name: "Rewards", email: "rewards@pacsun.com" }],
          bcc: [],
          reply_to: [],
          sent_at: "2026-08-23T10:00:00Z",
          snippet: "Sale items",
          body: { text: "Sale", had_html: false, truncated: false },
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
        <ThreadList
          accounts={[
            {
              connection_id: "conn-1",
              provider: "google",
              account_id: "acc-1",
              email: "mattdev727@gmail.com",
              display_name: "mattdev727",
              total: 1,
              unread: 0,
            },
          ]}
          threads={[threadWithCc]}
          totalCount={1}
          selectedKey=""
          loading={false}
          loadingMore={false}
          canLoadMore={false}
          onOpen={() => undefined}
          onRefresh={() => undefined}
          onLoadMore={() => undefined}
          onAction={() => undefined}
        />,
      );
    });

    // Senders column should show Pacsun, Rewards and NOT include recipient mattdev727
    expect(container.textContent).toContain("Pacsun, Rewards");
    expect(container.textContent).not.toContain("Pacsun, mattdev727");
  });
});
