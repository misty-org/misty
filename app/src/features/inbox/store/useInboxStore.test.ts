import { mailApi, type MailAccount, type MailThread } from "@/api/mail";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetInboxAccountState, selectUnifiedThreads, useInboxStore } from "./useInboxStore";

vi.mock("@/api/mail", () => ({
  mailApi: {
    accounts: vi.fn(),
    folders: vi.fn(),
    threads: vi.fn(),
    thread: vi.fn(),
    actOnThread: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    sendDraft: vi.fn(),
  },
}));

const accounts: MailAccount[] = [
  {
    connection_id: "good",
    provider: "google",
    account_id: "a",
    email: "a@example.com",
    display_name: "A",
    total: 1,
    unread: 1,
  },
  {
    connection_id: "bad",
    provider: "google",
    account_id: "b",
    email: "b@example.com",
    display_name: "B",
    total: 1,
    unread: 1,
  },
];

function thread(id: string): MailThread {
  return {
    provider: "gmail",
    provider_id: id,
    account_id: "a",
    subject: "Real email",
    snippet: "From the API",
    participants: [{ email: "sender@example.com" }],
    labels: ["INBOX"],
    last_message_at: "2026-08-19T12:00:00Z",
    unread: true,
    starred: false,
    messages: [],
  };
}

function detailedThread(id: string): MailThread {
  return {
    ...thread(id),
    unread: false,
    messages: [
      {
        provider: "gmail",
        provider_id: `message-${id}`,
        account_id: "a",
        thread_id: id,
        subject: "Real email",
        from: { email: "sender@example.com" },
        to: [{ email: "a@example.com" }],
        cc: [],
        bcc: [],
        reply_to: [],
        sent_at: "2026-08-19T12:00:00Z",
        snippet: "From the API",
        body: { text: "Prefetched body", had_html: false, truncated: false },
        labels: ["INBOX"],
        unread: false,
        starred: false,
        draft: false,
        attachments: [],
      },
    ],
  };
}

describe("Inbox store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInboxAccountState();
    vi.mocked(mailApi.folders).mockResolvedValue({ folders: [] });
    vi.mocked(mailApi.thread).mockImplementation(async (_connectionId, threadId) => ({
      thread: thread(threadId),
    }));
  });

  it("keeps healthy accounts visible when another provider fails", async () => {
    vi.mocked(mailApi.accounts).mockResolvedValue({ accounts });
    vi.mocked(mailApi.threads).mockImplementation(async ({ connectionId }) => {
      if (connectionId === "bad") throw new Error("Reconnect this account");
      return { threads: [thread("thread-1")], next_page_token: undefined };
    });
    useInboxStore.getState().setAccount("misty-account");
    await useInboxStore.getState().load();

    expect(selectUnifiedThreads(useInboxStore.getState())).toHaveLength(1);
    expect(useInboxStore.getState().accountErrors.bad).toBe("Reconnect this account");
    expect(useInboxStore.getState().error).toBeNull();
  });

  it("clears removed-account content during a force refresh", async () => {
    vi.mocked(mailApi.accounts).mockResolvedValue({ accounts: [accounts[0]] });
    vi.mocked(mailApi.threads).mockResolvedValue({ threads: [thread("thread-1")] });
    useInboxStore.getState().setAccount("misty-account");
    useInboxStore.setState({
      loaded: true,
      threadsByConnection: {
        removed: [{ ...thread("stale"), connectionId: "removed", key: "removed:stale" }],
      },
    });
    await useInboxStore.getState().load(true);

    expect(useInboxStore.getState().threadsByConnection.removed).toBeUndefined();
    expect(selectUnifiedThreads(useInboxStore.getState()).map((item) => item.provider_id)).toEqual([
      "thread-1",
    ]);
  });

  it("keeps a Microsoft identity without a mailbox visible without loading mail", async () => {
    vi.mocked(mailApi.accounts).mockResolvedValue({
      accounts: [
        {
          connection_id: "microsoft-no-mailbox",
          provider: "microsoft",
          account_id: "msa",
          email: "login@gmail.com",
          display_name: "Microsoft account",
          total: 0,
          unread: 0,
          status: "needs_attention",
          error_code: "mail_provider_mailbox_unavailable",
        },
      ],
    });
    useInboxStore.getState().setAccount("misty-account");
    await useInboxStore.getState().load();

    expect(mailApi.folders).not.toHaveBeenCalled();
    expect(mailApi.threads).not.toHaveBeenCalled();
    expect(useInboxStore.getState().accountErrors["microsoft-no-mailbox"]).toContain(
      "no Outlook mailbox",
    );
  });

  it("maps a unified folder choice to each provider account", async () => {
    vi.mocked(mailApi.threads).mockResolvedValue({ threads: [] });
    useInboxStore.getState().setAccount("misty-account");
    useInboxStore.setState({
      loaded: true,
      accounts,
      foldersByConnection: {
        good: [
          {
            provider: "google",
            provider_id: "SENT",
            account_id: "a",
            name: "Sent",
            kind: "sent",
            system: true,
            total: 3,
            unread: 0,
          },
        ],
        bad: [
          {
            provider: "microsoft",
            provider_id: "sentitems",
            account_id: "b",
            name: "Sent Items",
            kind: "sent",
            system: true,
            total: 4,
            unread: 0,
          },
        ],
      },
    });

    await useInboxStore.getState().selectFolderKind("sent");

    expect(mailApi.threads).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "good", folderId: "SENT" }),
    );
    expect(mailApi.threads).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "bad", folderId: "sentitems" }),
    );
  });

  it("prefetches message bodies after returning the thread summaries", async () => {
    vi.mocked(mailApi.accounts).mockResolvedValue({ accounts: [accounts[0]] });
    vi.mocked(mailApi.threads).mockResolvedValue({ threads: [thread("thread-1")] });
    vi.mocked(mailApi.thread).mockResolvedValue({ thread: detailedThread("thread-1") });
    useInboxStore.getState().setAccount("misty-account");

    await useInboxStore.getState().load();

    await vi.waitFor(() =>
      expect(selectUnifiedThreads(useInboxStore.getState())[0]?.messages).toHaveLength(1),
    );
    expect(mailApi.thread).toHaveBeenCalledWith("good", "thread-1");
  });

  it("opens a fresh cached message without another provider request", async () => {
    const cached = {
      ...detailedThread("thread-1"),
      connectionId: "good",
      key: "good:thread-1",
    };
    useInboxStore.getState().setAccount("misty-account");
    useInboxStore.setState({
      threadsByConnection: { good: [cached] },
      detailFetchedAtByThread: { [cached.key]: Date.now() },
    });

    await useInboxStore.getState().openThread(cached);

    expect(useInboxStore.getState().selectedThread?.messages[0]?.body.text).toBe("Prefetched body");
    expect(mailApi.thread).not.toHaveBeenCalled();
  });
});
