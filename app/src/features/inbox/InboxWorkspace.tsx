import { useAuth } from "@/features/auth";
import type { MailDraftInput } from "@/api/mail";
import { reportSystemError } from "@/features/activity";
import { useAiSurfaceAdapter, type AiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useConnectionsStore } from "@/features/integrations";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import { cn, PermissionState } from "@/shared/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { ComposeDialog } from "./components/ComposeDialog";
import { InboxBottomBar } from "./components/InboxBottomBar";
import { InboxSidebar } from "./components/InboxSidebar";
import { ThreadDetail } from "./components/ThreadDetail";
import { ThreadList } from "./components/ThreadList";
import { selectVisibleInboxThreads, useInboxStore } from "./store/useInboxStore";
import type { InboxThread, ReplyMode } from "./model";
import { useInboxKeyboardShortcuts } from "./useInboxKeyboardShortcuts";

let refreshInboxAfterAuthorization = false;

export function InboxWorkspace() {
  const { user, transitioning } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedThread = searchParams.get("thread");
  const messageVisible = searchParams.get("view") === "message";
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<InboxThread | null>(null);
  const [replyMode, setReplyMode] = useState<ReplyMode>("reply");
  const [aiDraft, setAiDraft] = useState<{
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    text?: string;
  }>();
  const [notice, setNotice] = useState("");
  const [reconnectingConnectionId, setReconnectingConnectionId] = useState("");
  const [leftShelfVisible, setLeftShelfVisible] = useState(true);

  const inbox = useInboxStore(
    useShallow((state) => ({
      accountId: state.accountId,
      accounts: state.accounts,
      foldersByConnection: state.foldersByConnection,
      threadsByConnection: state.threadsByConnection,
      nextPageByConnection: state.nextPageByConnection,
      estimatedTotalByConnection: state.estimatedTotalByConnection,
      accountErrors: state.accountErrors,
      accountErrorCodes: state.accountErrorCodes,
      selectedProvider: state.selectedProvider,
      selectedConnectionId: state.selectedConnectionId,
      selectedFolderKind: state.selectedFolderKind,
      selectedThreadKey: state.selectedThreadKey,
      selectedThread: state.selectedThread,
      query: state.query,
      loading: state.loading,
      loadingMore: state.loadingMore,
      detailLoading: state.detailLoading,
      actioning: state.actioning,
      error: state.error,
      setAccount: state.setAccount,
      load: state.load,
      selectScope: state.selectScope,
      selectFolderKind: state.selectFolderKind,
      search: state.search,
      loadMore: state.loadMore,
      openThread: state.openThread,
      actOnThread: state.actOnThread,
      saveDraft: state.saveDraft,
      sendDraft: state.sendDraft,
    })),
  );

  const threads = useMemo(
    () =>
      selectVisibleInboxThreads({
        accounts: inbox.accounts,
        selectedConnectionId: inbox.selectedConnectionId,
        selectedProvider: inbox.selectedProvider,
        threadsByConnection: inbox.threadsByConnection,
      }),
    [inbox.accounts, inbox.selectedConnectionId, inbox.selectedProvider, inbox.threadsByConnection],
  );

  const visibleAccounts = useMemo(
    () =>
      inbox.selectedProvider
        ? inbox.accounts.filter((account) => account.provider === inbox.selectedProvider)
        : inbox.accounts,
    [inbox.accounts, inbox.selectedProvider],
  );
  const visibleConnectionIds = useMemo(
    () => new Set(visibleAccounts.map((account) => account.connection_id)),
    [visibleAccounts],
  );

  const connections = useConnectionsStore(
    useShallow((state) => ({
      accountId: state.accountId,
      authorizingProvider: state.authorizingProvider,
      removingConnectionId: state.removingConnectionId,
      error: state.error,
      setAccount: state.setAccount,
      beginAuthorization: state.beginAuthorization,
      remove: state.remove,
      clearError: state.clearError,
    })),
  );

  const setInboxAccount = inbox.setAccount;
  const loadInbox = inbox.load;
  const openInboxThread = inbox.openThread;
  const selectedInboxThreadKey = inbox.selectedThreadKey;
  const setConnectionsAccount = connections.setAccount;

  useEffect(() => {
    const accountId = user?.id ?? "";
    setInboxAccount(accountId);
    setConnectionsAccount(accountId);
  }, [setConnectionsAccount, setInboxAccount, user?.id]);

  useEffect(() => {
    if (!user?.id || inbox.accountId !== user.id) return;
    const force = refreshInboxAfterAuthorization;
    refreshInboxAfterAuthorization = false;
    void loadInbox(force);
    const refresh = () => void loadInbox(true);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [inbox.accountId, loadInbox, user?.id]);

  useEffect(() => {
    for (const [connectionId, error] of Object.entries(inbox.accountErrors)) {
      const account = inbox.accounts.find((candidate) => candidate.connection_id === connectionId);
      const label = account?.display_name || account?.email || "Email account";
      reportSystemError({
        accountId: user?.id,
        scope: `inbox:${connectionId}`,
        title: `${label} could not refresh`,
        error,
        target: { kind: "route", href: "/inbox" },
      });
    }
  }, [inbox.accountErrors, inbox.accounts, user?.id]);

  useEffect(() => {
    if (inbox.error) {
      reportSystemError({
        accountId: user?.id,
        scope: "inbox",
        title: "Inbox needs attention",
        error: inbox.error,
        target: { kind: "route", href: "/inbox" },
      });
    }
    if (connections.error) {
      reportSystemError({
        accountId: user?.id,
        scope: "inbox:connections",
        title: "Email connection needs attention",
        error: connections.error,
        target: { kind: "route", href: "/inbox" },
      });
    }
  }, [connections.error, inbox.error, user?.id]);

  const canLoadMore = useMemo(
    () =>
      Object.entries(inbox.nextPageByConnection).some(
        ([connectionId, token]) =>
          Boolean(token) &&
          ((!inbox.selectedProvider && !inbox.selectedConnectionId) ||
            visibleConnectionIds.has(connectionId)) &&
          (!inbox.selectedConnectionId || inbox.selectedConnectionId === connectionId),
      ),
    [
      inbox.nextPageByConnection,
      inbox.selectedConnectionId,
      inbox.selectedProvider,
      visibleConnectionIds,
    ],
  );

  const totalCount = useMemo(() => {
    const estimatedTotal = Object.entries(inbox.estimatedTotalByConnection).reduce(
      (total, [connectionId, count]) =>
        (!inbox.selectedProvider && !inbox.selectedConnectionId) ||
        visibleConnectionIds.has(connectionId)
          ? total + count
          : total,
      0,
    );
    return Math.max(threads.length, estimatedTotal);
  }, [
    inbox.estimatedTotalByConnection,
    inbox.selectedConnectionId,
    inbox.selectedProvider,
    threads.length,
    visibleConnectionIds,
  ]);

  const openCompose = (thread: InboxThread | null, mode: ReplyMode = "reply") => {
    setAiDraft(undefined);
    setReplyTo(thread);
    setReplyMode(mode);
    setComposeOpen(true);
  };

  const rememberMessageView = useCallback(
    (visible: boolean, thread?: InboxThread | null) => {
      const next = new URLSearchParams(searchParams);
      next.set("view", visible ? "message" : "list");
      if (thread) next.set("thread", thread.key);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (!requestedThread || !threads.length) return;
    const thread = threads.find(
      (candidate) => candidate.key === requestedThread || candidate.provider_id === requestedThread,
    );
    if (!thread || selectedInboxThreadKey === thread.key) return;
    void openInboxThread(thread);
  }, [openInboxThread, requestedThread, selectedInboxThreadKey, threads]);

  const handleOpenThread = (thread: InboxThread) => {
    rememberMessageView(true, thread);
    void inbox.openThread(thread);
  };

  const handleCloseThread = () => {
    rememberMessageView(false, inbox.selectedThread);
  };

  const handleFocusSearch = () => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search mail"]');
    input?.focus();
    input?.select();
  };

  useInboxKeyboardShortcuts({
    threads,
    selectedThread: inbox.selectedThread,
    selectedThreadKey: inbox.selectedThreadKey,
    isComposerOpen: composeOpen,
    messageVisible,
    onOpenThread: handleOpenThread,
    onCloseThread: handleCloseThread,
    onOpenCompose: (mode) => openCompose(inbox.selectedThread, mode ?? "reply"),
    onAction: (thread, action) => void inbox.actOnThread(thread, action).catch(() => undefined),
    onFocusSearch: handleFocusSearch,
  });

  const aiAdapter = useMemo<AiSurfaceAdapter | null>(() => {
    const thread = inbox.selectedThread;
    if (!thread || !messageVisible) return null;
    const content = inboxThreadAiText(thread).slice(0, 32 << 10);
    return {
      surfaceId: "inbox",
      label: thread.subject,
      getContext: () => [
        {
          kind: "mail.thread",
          id: thread.provider_id,
          title: thread.subject,
          privacy: "provider",
          opaqueScopeId: thread.connectionId,
          metadata: { provider: thread.provider, message_count: thread.messages.length },
        },
      ],
      getSelection: () => ({
        kind: "text",
        content,
        object: { kind: "mail.thread", id: thread.provider_id },
        anchors: { message_count: thread.messages.length },
        contentHash: aiContentHash(content),
      }),
      getSuggestedActions: () => [
        {
          id: "thread-summary",
          label: "Summarize thread",
          prompt:
            "Summarize this email thread, including the latest state and any unanswered questions.",
        },
        {
          id: "draft-reply",
          label: "Draft reply",
          prompt: "Draft a concise, helpful reply to this thread. Do not send it.",
          requestedArtifactKind: "mail_draft",
        },
        {
          id: "extract-commitments",
          label: "Find commitments",
          prompt: "List commitments, owners, dates, and unresolved decisions in this email thread.",
        },
      ],
      applyArtifact: async (artifact) => {
        if (artifact.kind !== "mail_draft")
          throw new Error("This email draft is not supported here.");
        const operations = artifact.operations as {
          to?: string[];
          subject?: string;
          text?: string;
        };
        setAiDraft({
          to: operations.to?.join(", "),
          subject: operations.subject,
          text: operations.text,
        });
        setReplyTo(thread);
        setReplyMode("reply");
        setComposeOpen(true);
      },
    };
  }, [inbox.selectedThread, messageVisible]);
  useAiSurfaceAdapter(aiAdapter);

  if (transitioning) return <CenteredMessage label="Switching accounts…" />;
  if (!user) {
    return (
      <PermissionState
        className="h-full"
        title="Sign in to open Inbox"
        description="Email accounts are private to your Misty account."
      />
    );
  }

  const connect = async (provider: string, connectionId = "") => {
    setNotice("");
    connections.clearError();
    setReconnectingConnectionId(connectionId);
    try {
      const openResult = await openProviderAuthorizationLink(
        await connections.beginAuthorization(provider, ["mail"], "/inbox"),
      );
      if (openResult?.strategy === "misty-browser") refreshInboxAfterAuthorization = true;
      setNotice(connectionId ? "Finish reconnecting, then refresh Inbox." : "Finish connecting.");
    } catch {
      // The connection store retains a safe error message.
    } finally {
      setReconnectingConnectionId((current) => (current === connectionId ? "" : current));
    }
  };

  const removeAccount = async (account: (typeof inbox.accounts)[number]) => {
    setNotice("");
    connections.clearError();
    try {
      await connections.remove(account.connection_id);
      await inbox.load(true);
      if (inbox.selectedConnectionId === account.connection_id) await inbox.selectScope("");
      const providerName = account.provider === "google" ? "Gmail" : "Outlook";
      setNotice(`${providerName} account removed from Misty.`);
      setTimeout(() => setNotice(""), 3000);
    } catch {
      // The connection store retains a safe error message.
    }
  };

  const handleConvertToTask = (thread: InboxThread) => {
    setNotice(`Created planner task from: “${thread.subject}”`);
    setTimeout(() => setNotice(""), 4000);
  };

  const handleClipToJournal = (thread: InboxThread) => {
    setNotice(`Clipped “${thread.subject}” to Space Journal`);
    setTimeout(() => setNotice(""), 4000);
  };

  const handleSendQuickReply = async (draftPayload: MailDraftInput) => {
    const saved = await inbox.saveDraft(draftPayload);
    await inbox.sendDraft(saved.provider_id, draftPayload.connection_id);
    setNotice("Reply sent.");
    setTimeout(() => setNotice(""), 3000);
  };

  const shelfGrid = leftShelfVisible
    ? "grid-cols-[248px_minmax(0,1fr)] max-[1100px]:grid-cols-[220px_minmax(0,1fr)]"
    : "grid-cols-[minmax(0,1fr)]";

  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg">
      <div className={cn("grid min-h-0 flex-1 overflow-hidden", shelfGrid)}>
        {leftShelfVisible ? (
          <InboxSidebar
            accounts={visibleAccounts}
            foldersByConnection={inbox.foldersByConnection}
            accountErrorCodes={inbox.accountErrorCodes}
            provider={inbox.selectedProvider || "google"}
            selectedConnectionId={inbox.selectedConnectionId}
            selectedFolderKind={inbox.selectedFolderKind}
            loading={inbox.loading}
            onSelectAccount={(connectionId) => void inbox.selectScope(connectionId)}
            onSelectFolderKind={(kind) => void inbox.selectFolderKind(kind)}
            onCompose={() => openCompose(null)}
            authorizationPending={Boolean(connections.authorizingProvider)}
            reconnectingConnectionId={reconnectingConnectionId}
            removingConnectionId={connections.removingConnectionId ?? ""}
            onConnectAccount={() => void connect(inbox.selectedProvider || "google")}
            onReconnectAccount={(account) => void connect(account.provider, account.connection_id)}
            onRemoveAccount={(account) => void removeAccount(account)}
          />
        ) : null}

        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <ThreadList
            accounts={visibleAccounts}
            threads={threads}
            totalCount={totalCount}
            selectedKey={inbox.selectedThreadKey}
            query={inbox.query}
            loading={inbox.loading}
            loadingMore={inbox.loadingMore}
            canLoadMore={canLoadMore}
            onSearch={(query) => void inbox.search(query)}
            onOpen={handleOpenThread}
            onRefresh={() => void inbox.load(true)}
            onLoadMore={() => void inbox.loadMore()}
            onAction={(thread, action) =>
              void inbox.actOnThread(thread, action).catch(() => undefined)
            }
          />

          {inbox.selectedThread ? (
            <div
              className={cn(
                "absolute inset-0 z-10 min-h-0 bg-charcoal-bg transition-transform duration-200 ease-out",
                messageVisible ? "translate-x-0" : "pointer-events-none translate-x-full",
              )}
              data-inbox-message-view
              data-state={messageVisible ? "open" : "closed"}
            >
              <ThreadDetail
                thread={inbox.selectedThread}
                accounts={visibleAccounts}
                loading={inbox.detailLoading}
                actioning={inbox.actioning}
                onAction={(action) => {
                  if (inbox.selectedThread)
                    void inbox.actOnThread(inbox.selectedThread, action).catch(() => undefined);
                }}
                onReply={(mode) =>
                  inbox.selectedThread && openCompose(inbox.selectedThread, mode ?? "reply")
                }
                onSendQuickReply={handleSendQuickReply}
                onExpandToModal={(draft) => {
                  setAiDraft({
                    to: draft.to,
                    cc: draft.cc,
                    bcc: draft.bcc,
                    subject: draft.subject,
                    text: draft.text,
                  });
                  setReplyTo(inbox.selectedThread);
                  setReplyMode(draft.mode);
                  setComposeOpen(true);
                }}
                onConvertToTask={handleConvertToTask}
                onClipToJournal={handleClipToJournal}
                onBack={handleCloseThread}
              />
            </div>
          ) : null}
        </div>
      </div>

      <InboxBottomBar
        leftShelfVisible={leftShelfVisible}
        messageAvailable={Boolean(inbox.selectedThread)}
        messageVisible={messageVisible && Boolean(inbox.selectedThread)}
        accountCount={inbox.accounts.length}
        messageCount={totalCount}
        onToggleLeftShelf={() => setLeftShelfVisible((visible) => !visible)}
        onToggleMessage={() => rememberMessageView(!messageVisible, inbox.selectedThread)}
      />

      <ComposeDialog
        open={composeOpen}
        accounts={visibleAccounts}
        replyTo={replyTo}
        replyMode={replyMode}
        initialDraft={aiDraft}
        onOpenChange={setComposeOpen}
        onSave={inbox.saveDraft}
        onSend={inbox.sendDraft}
      />

      {notice ? (
        <div
          className={cn(
            "absolute bottom-10 left-1/2 z-20 max-w-lg -translate-x-1/2 rounded-md",
            "border border-charcoal-border bg-charcoal-card px-3 py-2 text-xs text-cream shadow-lg",
          )}
        >
          {notice}
        </div>
      ) : null}
    </main>
  );
}

function inboxThreadAiText(thread: InboxThread) {
  const messages = thread.messages.length
    ? thread.messages.map((message) => {
        const attachments = message.attachments
          .map((item) => `${item.filename} (${item.content_type}, ${item.size} bytes)`)
          .join(", ");
        const sender = message.from.name || message.from.email;
        const body = message.body.text || message.snippet;
        return `${message.sent_at} — ${sender}\n${body}${attachments ? `\nAttachments: ${attachments}` : ""}`;
      })
    : [thread.snippet];
  return `Subject: ${thread.subject}\nParticipants: ${thread.participants.map((item) => item.name || item.email).join(", ")}\n\n${messages.join("\n\n")}`;
}

function aiContentHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function CenteredMessage({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg text-xs text-cream-muted">
      {label}
    </div>
  );
}
