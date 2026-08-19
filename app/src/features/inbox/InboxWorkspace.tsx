import { useAuth } from "@/features/auth";
import { useConnectionsStore } from "@/features/integrations";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import { Button, cn, PermissionState } from "@/shared/ui";
import { Mail } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SiGmail } from "react-icons/si";
import { useShallow } from "zustand/react/shallow";
import { ComposeDialog } from "./components/ComposeDialog";
import { InboxBottomBar } from "./components/InboxBottomBar";
import { InboxSidebar } from "./components/InboxSidebar";
import { ThreadDetail } from "./components/ThreadDetail";
import { ThreadList } from "./components/ThreadList";
import { inboxProviderCatalog } from "./providerCatalog";
import { selectUnifiedThreads, useInboxStore } from "./store/useInboxStore";
import type { InboxThread } from "./model";

export function InboxWorkspace() {
  const { user, transitioning } = useAuth();
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<InboxThread | null>(null);
  const [notice, setNotice] = useState("");
  const [leftShelfVisible, setLeftShelfVisible] = useState(true);
  const [messageVisible, setMessageVisible] = useState(false);
  const inbox = useInboxStore(
    useShallow((state) => ({
      accountId: state.accountId,
      accounts: state.accounts,
      foldersByConnection: state.foldersByConnection,
      threadsByConnection: state.threadsByConnection,
      nextPageByConnection: state.nextPageByConnection,
      estimatedTotalByConnection: state.estimatedTotalByConnection,
      accountErrors: state.accountErrors,
      selectedConnectionId: state.selectedConnectionId,
      selectedFolderKind: state.selectedFolderKind,
      selectedThreadKey: state.selectedThreadKey,
      selectedThread: state.selectedThread,
      loading: state.loading,
      loadingMore: state.loadingMore,
      detailLoading: state.detailLoading,
      actioning: state.actioning,
      error: state.error,
      setAccount: state.setAccount,
      load: state.load,
      selectScope: state.selectScope,
      selectFolderKind: state.selectFolderKind,
      loadMore: state.loadMore,
      openThread: state.openThread,
      prefetchThread: state.prefetchThread,
      actOnThread: state.actOnThread,
      saveDraft: state.saveDraft,
      sendDraft: state.sendDraft,
    })),
  );
  const threads = useMemo(
    () => selectUnifiedThreads({ threadsByConnection: inbox.threadsByConnection }),
    [inbox.threadsByConnection],
  );
  const connections = useConnectionsStore(
    useShallow((state) => ({
      accountId: state.accountId,
      authorizingProvider: state.authorizingProvider,
      error: state.error,
      setAccount: state.setAccount,
      beginAuthorization: state.beginAuthorization,
      clearError: state.clearError,
    })),
  );
  const setInboxAccount = inbox.setAccount;
  const loadInbox = inbox.load;
  const setConnectionsAccount = connections.setAccount;

  useEffect(() => {
    const accountId = user?.id ?? "";
    setInboxAccount(accountId);
    setConnectionsAccount(accountId);
  }, [setConnectionsAccount, setInboxAccount, user?.id]);
  useEffect(() => {
    if (user?.id && inbox.accountId === user.id) void loadInbox();
  }, [inbox.accountId, loadInbox, user?.id]);

  const canLoadMore = useMemo(
    () =>
      Object.entries(inbox.nextPageByConnection).some(
        ([connectionId, token]) =>
          Boolean(token) &&
          (!inbox.selectedConnectionId || inbox.selectedConnectionId === connectionId),
      ),
    [inbox.nextPageByConnection, inbox.selectedConnectionId],
  );
  const totalCount = useMemo(() => {
    const estimatedTotal = Object.values(inbox.estimatedTotalByConnection).reduce(
      (total, count) => total + count,
      0,
    );
    return Math.max(threads.length, estimatedTotal);
  }, [inbox.estimatedTotalByConnection, threads.length]);

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

  const connect = async (provider: string) => {
    setNotice("");
    connections.clearError();
    try {
      await openProviderAuthorizationLink(
        await connections.beginAuthorization(provider, ["mail"], "/inbox"),
      );
      setNotice("Finish connecting in your browser, then refresh Inbox.");
    } catch {
      // The connection store retains a safe error message.
    }
  };
  const openCompose = (thread: InboxThread | null) => {
    setReplyTo(thread);
    setComposeOpen(true);
  };
  const shelfGrid = leftShelfVisible
    ? "grid-cols-[248px_minmax(0,1fr)] max-[1100px]:grid-cols-[220px_minmax(0,1fr)]"
    : "grid-cols-[minmax(0,1fr)]";

  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg">
      <div className={cn("grid min-h-0 flex-1 overflow-hidden", shelfGrid)}>
        {leftShelfVisible ? (
          <InboxSidebar
            accounts={inbox.accounts}
            foldersByConnection={inbox.foldersByConnection}
            accountErrors={inbox.accountErrors}
            selectedConnectionId={inbox.selectedConnectionId}
            selectedFolderKind={inbox.selectedFolderKind}
            loading={inbox.loading}
            onSelectAccount={(connectionId) => void inbox.selectScope(connectionId)}
            onSelectFolderKind={(kind) => void inbox.selectFolderKind(kind)}
            onCompose={() => openCompose(null)}
            connectionActions={inboxProviderCatalog.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                size="sm"
                variant="ghost"
                className="justify-start"
                disabled={Boolean(connections.authorizingProvider)}
                onClick={() => void connect(provider.id)}
              >
                {provider.id === "google" ? (
                  <SiGmail className="size-3.5 text-[#EA4335]" />
                ) : (
                  <Mail className="size-3.5 text-[#0078D4]" />
                )}
                {connections.authorizingProvider === provider.id
                  ? "Connecting…"
                  : `Connect ${provider.name}`}
              </Button>
            ))}
          />
        ) : null}

        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <ThreadList
            accounts={inbox.accounts}
            threads={threads}
            totalCount={totalCount}
            selectedKey={inbox.selectedThreadKey}
            loading={inbox.loading}
            loadingMore={inbox.loadingMore}
            canLoadMore={canLoadMore}
            onOpen={(thread) => {
              setMessageVisible(true);
              void inbox.openThread(thread);
            }}
            onPrefetch={(thread) => void inbox.prefetchThread(thread)}
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
                loading={inbox.detailLoading}
                actioning={inbox.actioning}
                onAction={(action) => {
                  if (inbox.selectedThread)
                    void inbox.actOnThread(inbox.selectedThread, action).catch(() => undefined);
                }}
                onReply={() => inbox.selectedThread && openCompose(inbox.selectedThread)}
                onBack={() => setMessageVisible(false)}
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
        onToggleMessage={() => setMessageVisible((visible) => !visible)}
      />

      <ComposeDialog
        open={composeOpen}
        accounts={inbox.accounts}
        replyTo={replyTo}
        onOpenChange={setComposeOpen}
        onSave={inbox.saveDraft}
        onSend={inbox.sendDraft}
      />

      {inbox.error || connections.error || notice ? (
        <div
          className={cn(
            "absolute bottom-10 left-1/2 z-20 max-w-lg -translate-x-1/2 rounded-md",
            "border border-charcoal-border bg-charcoal-card px-3 py-2 text-xs text-cream shadow-lg",
          )}
        >
          {inbox.error || connections.error || notice}
        </div>
      ) : null}
    </main>
  );
}

function CenteredMessage({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center bg-charcoal-bg text-xs text-cream-muted">
      {label}
    </div>
  );
}
