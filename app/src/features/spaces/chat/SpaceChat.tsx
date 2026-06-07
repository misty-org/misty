export type { ChatComposerSuggestion } from "@/api/spaces/dto/types/SpaceChat";
import type { SocialProviderId } from "@/api/social";
import { useConnectionsStore } from "@/features/integrations";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { Lightbulb, LightbulbOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { useSetupStore } from "@/features/installer";
import type { MistyPickerSource } from "@/features/picker";
import { SpaceSetupCards } from "@/features/spaces";
import { useWorkspaceTabTitle } from "@/features/workspace";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { DeleteMessageDialog } from "./components/ChatMessages";
import { ChatPresencePill } from "./components/ChatPresencePill";
import { ChatReadOnlyNotice } from "./components/ChatReadOnlyNotice";
import { SpaceChatComposer } from "./components/SpaceChatComposer";
import { SpaceChatPicker } from "@/features/chat-composer/SpaceChatPicker";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { SpaceChatThread } from "./components/SpaceChatThread";
import { useChatScrollRestoration } from "./hooks/useChatScrollRestoration";
import { useChatSuggestions } from "./hooks/useChatSuggestions";
import { useComposerInput } from "./hooks/useComposerInput";
import { useMessageEditing } from "./hooks/useMessageEditing";
import { usePendingAgentRuns } from "./hooks/usePendingAgentRuns";
import { useSpaceActionSuggestions } from "./hooks/useSpaceActionSuggestions";
import { useSpaceChatScope, useSpaceChatStore } from "./hooks/useSpaceChatData";
import { useSpaceChatMessageActions } from "./hooks/useSpaceChatMessageActions";
import { useSpaceChatPermissions } from "./hooks/useSpaceChatPermissions";
import { useSpaceConversationChat } from "./hooks/useSpaceConversationChat";
import {
  socialConversationPath,
  socialProvider as normalizeSocialProvider,
  socialProviderPath,
} from "../social/socialRoute";

export function SpaceSocial({
  spaceId,
  spaceName,
  provider,
  workspaceTabId,
}: {
  spaceId: string;
  spaceName: string;
  provider: SocialProviderId;
  workspaceTabId?: string;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const setupUser = useSetupStore((state) => state.status?.current_user ?? null);
  const user = authUser ?? setupUser;
  const conversationId = searchParams.get("conversation") ?? "";
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastReadReceiptRef = useRef("");

  const initialAccess = useSpaceChatPermissions(spaceId, conversationId);
  const resolvesProviderLanding =
    provider !== "misty" || initialAccess.activeSpace?.kind === "misty";
  const store = useSpaceChatStore();
  const conversationChat = useSpaceConversationChat(
    spaceId,
    conversationId,
    initialAccess.canReadMessages,
    resolvesProviderLanding,
  );
  const scope = useSpaceChatScope({
    spaceId,
    conversationId,
    currentUserId: user?.id,
    conversations: conversationChat.conversations,
    conversationMessages: conversationChat.messages,
    store,
  });
  const access = useSpaceChatPermissions(spaceId, conversationId, scope.activeConversation?.kind);
  useWorkspaceTabTitle(workspaceTabId, `${spaceName} Social`);
  const {
    accountId: connectionsAccountId,
    connections: accountConnections,
    loading: connectionsLoading,
    authorizingProvider,
    error: connectionsError,
    setAccount: setConnectionsAccount,
    load: loadConnections,
    beginAuthorization,
    clearError: clearConnectionsError,
  } = useConnectionsStore(
    useShallow((state) => ({
      accountId: state.accountId,
      connections: state.connections,
      loading: state.loading,
      authorizingProvider: state.authorizingProvider,
      error: state.error,
      setAccount: state.setAccount,
      load: state.load,
      beginAuthorization: state.beginAuthorization,
      clearError: state.clearError,
    })),
  );
  const landingConversation = socialLandingConversation(
    provider,
    initialAccess.activeSpace?.kind,
    conversationChat.conversations,
  );
  const providerConnected =
    provider !== "misty" &&
    connectionsAccountId === user?.id &&
    accountConnections.some(
      (connection) => normalizeSocialProvider(connection.provider) === provider,
    );
  const actionSuggestions = useSpaceActionSuggestions(
    spaceId,
    conversationId,
    initialAccess.activeSpace?.kind !== "misty" && !scope.activeConversation?.direct_agent_id,
  );

  useEffect(() => {
    if (conversationId || !resolvesProviderLanding || !landingConversation) return;
    navigate(socialConversationPath(spaceId, provider, landingConversation.id), { replace: true });
  }, [conversationId, landingConversation, navigate, provider, resolvesProviderLanding, spaceId]);

  useEffect(() => {
    if (provider === "misty" || !user?.id) return;
    setConnectionsAccount(user.id);
    void loadConnections();
  }, [loadConnections, provider, setConnectionsAccount, user?.id]);

  const connectProvider = async () => {
    if (provider === "misty") return;
    clearConnectionsError();
    try {
      const authorizationUrl = await beginAuthorization(
        provider,
        ["social_read", "social_send", "social_automation"],
        socialProviderPath(spaceId, provider),
      );
      await openProviderAuthorizationLink(authorizationUrl);
    } catch {
      // The connections store retains the user-safe failure message rendered below.
    }
  };

  const agentTurns = usePendingAgentRuns(spaceId, conversationId);
  const draft = useSpaceChatDraft(spaceId, conversationId);
  const editing = useMessageEditing();
  const suggestions = useChatSuggestions({
    spaceId,
    members: scope.members,
    agents: scope.agents,
    currentUserId: user?.id,
    canBrowseLibrary: access.canBrowseLibrary,
    canReadLibrary: access.permissions?.["library.view"] !== false,
    selectedLibraryIds: draft.selectedLibraryIds,
    attachmentSlotsLeft: draft.attachmentSlotsLeft,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<MistyPickerSource>("files");
  const [messageToDelete, setMessageToDelete] = useState<SpaceMessage | null>(null);
  const [suggestionVeto, setSuggestionVeto] = useState(false);
  const resetDraft = draft.reset;
  const resetEditing = editing.reset;
  const closeSuggestions = suggestions.setOpen;
  const clearSpacesError = store.clearSpacesError;
  const loadChatAgents = store.loadChatAgents;
  const markRead = store.markRead;
  useEffect(() => {
    if (!conversationId || scope.activeConversation?.direct_agent_id) {
      setSuggestionVeto(false);
      return;
    }
    let active = true;
    void spacesApi
      .conversationSuggestionVeto(spaceId, conversationId)
      .then(({ veto }) => {
        if (active) setSuggestionVeto(veto);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [conversationId, scope.activeConversation?.direct_agent_id, spaceId]);
  const toggleSuggestionVeto = async () => {
    if (!conversationId) return;
    const next = !suggestionVeto;
    await spacesApi.setConversationSuggestionVeto(spaceId, conversationId, next);
    setSuggestionVeto(next);
    if (next) void actionSuggestions.refresh();
  };
  const openPicker = (source: MistyPickerSource) => {
    setPickerSource(source);
    setPickerOpen(true);
  };
  const input = useComposerInput({
    draft,
    suggestions,
    canWriteMessages: access.canWriteMessages,
    canUploadAttachments: access.canUploadAttachments,
    canBrowseLibrary: access.canBrowseLibrary,
    openPicker,
  });
  const mentionNames = useMemo(
    () => [
      ...scope.members.map((member) => member.name),
      ...scope.agents.map((agent) => agent.name),
    ],
    [scope.members, scope.agents],
  );

  const actions = useSpaceChatMessageActions({
    spaceId,
    conversationId,
    currentUser: user ? { id: user.id, name: user.name } : undefined,
    activeConversation: scope.activeConversation,
    members: scope.members,
    agents: scope.agents,
    draft,
    editing,
    setGroupMessages: conversationChat.setMessages,
    setGroupChatError: conversationChat.setError,
    storeSendMessage: store.sendMessage,
    storeUpdateMessage: store.updateMessage,
    storeDeleteMessage: store.deleteMessage,
    storeToggleReaction: store.toggleMessageReaction,
    onAgentRunsQueued: agentTurns.track,
  });

  const messagesLoading = conversationId
    ? conversationChat.loading && conversationChat.messages.length === 0
    : (store.messageLoadingBySpace[spaceId] ?? store.loading) && scope.defaultMessages.length === 0;
  const messagesError = conversationId
    ? conversationChat.error
    : (store.messageErrorsBySpace[spaceId] ?? "");
  const activeProviderConversation = shouldShowSocialConversation(
    provider,
    conversationId,
    scope.activeConversation?.origin,
  );
  const draftText = draft.text;
  const setDraftText = draft.setText;
  const setDraftReplyToMessageId = draft.setReplyToMessageId;
  const aiAdapter = useMemo<AiSurfaceAdapter | null>(() => {
    if (!activeProviderConversation) return null;
    const scopeId = conversationId || "everyone";
    const messageDraft = (artifact: AiArtifact) => {
      if (artifact.kind !== "message_draft" || !access.canWriteMessages || draftText.trim()) {
        return null;
      }
      const operations = artifact.operations as {
        conversation_id?: string;
        text?: string;
        reply_to_message_id?: string;
      };
      if (
        operations.conversation_id !== scopeId ||
        typeof operations.text !== "string" ||
        !operations.text.trim() ||
        operations.text.length > 20_000
      ) {
        return null;
      }
      if (
        operations.reply_to_message_id &&
        !scope.messages.some((message) => message.id === operations.reply_to_message_id)
      ) {
        return null;
      }
      return operations;
    };
    return {
      surfaceId: "space.chat",
      label: scope.activeConversation?.title || "Everyone chat",
      getContext: () => [
        {
          kind: "space.chat",
          id: scopeId,
          title: scope.activeConversation?.title || "Everyone chat",
          privacy: "shared",
          spaceId,
          href: conversationId
            ? socialConversationPath(spaceId, provider, conversationId)
            : socialProviderPath(spaceId, provider),
          revision: scope.messages[scope.messages.length - 1]?.seq ?? 0,
        },
      ],
      getSuggestedActions: () => [
        {
          id: "recap",
          label: "Recap",
          prompt:
            "Recap the recent conversation with decisions, open questions, and important context. Cite the conversation.",
        },
        {
          id: "decisions",
          label: "Decisions",
          prompt: "Extract decisions and explain the evidence for each one.",
        },
        {
          id: "action-items",
          label: "Action items",
          prompt:
            "Extract a reviewed set of actionable Space tasks from this conversation. Do not invent owners or due dates.",
          requestedArtifactKind: "task_set",
        },
        {
          id: "draft-message",
          label: "Draft message",
          prompt: "Draft a concise message for this exact Space conversation. Do not post it.",
          requestedArtifactKind: "message_draft",
        },
        {
          id: "explain-thread",
          label: "Explain thread",
          prompt:
            "Explain this conversation to someone joining now, distinguishing facts from inference.",
        },
      ],
      canApply: (artifact) => Boolean(messageDraft(artifact)),
      applyArtifact: async (artifact) => {
        const operations = messageDraft(artifact);
        if (!operations) {
          throw new Error(
            "The conversation or composer changed. Ask Misty to regenerate this draft.",
          );
        }
        setDraftText(operations.text!.trim());
        setDraftReplyToMessageId(operations.reply_to_message_id ?? "");
      },
    };
  }, [
    access.canWriteMessages,
    activeProviderConversation,
    conversationId,
    draftText,
    provider,
    scope.activeConversation?.title,
    scope.messages,
    setDraftReplyToMessageId,
    setDraftText,
    spaceId,
  ]);
  useAiSurfaceAdapter(aiAdapter);
  const chatScroll = useChatScrollRestoration({
    viewerId: user?.id,
    spaceId,
    conversationId,
    ready:
      !messagesLoading &&
      (!conversationId || conversationChat.loadedConversationId === conversationId),
    messages: scope.messages,
    pendingRunCount: agentTurns.pending.length,
    targetMessageId: searchParams.get("message") ?? undefined,
  });

  // Switching Space (or identity) abandons anything staged in the composer.
  useEffect(() => {
    resetDraft();
    resetEditing();
    closeSuggestions(false);
    setPickerOpen(false);
    clearSpacesError();
    if (!store.referenceOnly && initialAccess.activeSpace?.kind !== "misty") {
      void loadChatAgents(spaceId);
    }
  }, [
    clearSpacesError,
    closeSuggestions,
    initialAccess.activeSpace?.kind,
    loadChatAgents,
    resetDraft,
    resetEditing,
    spaceId,
    store.referenceOnly,
    user?.id,
  ]);

  useEffect(() => {
    if (!activeProviderConversation) return;
    const last = scope.messages[scope.messages.length - 1];
    if (!last || store.referenceOnly) return;
    const receiptKey = `${spaceId}:${conversationId || "everyone"}:${last.seq}`;
    if (lastReadReceiptRef.current === receiptKey) return;
    lastReadReceiptRef.current = receiptKey;
    const request = conversationId
      ? spacesApi.markConversationRead(spaceId, conversationId, last.seq)
      : markRead(spaceId, last.seq);
    void request.catch(() => {
      if (lastReadReceiptRef.current === receiptKey) lastReadReceiptRef.current = "";
    });
  }, [
    activeProviderConversation,
    conversationId,
    markRead,
    scope.messages,
    spaceId,
    store.referenceOnly,
  ]);

  if (!conversationId && resolvesProviderLanding) {
    if (conversationChat.error) {
      return (
        <ErrorState
          className="h-full bg-charcoal-bg"
          title="Social couldn’t load"
          description={conversationChat.error}
          action={
            <Button type="button" variant="outline" onClick={conversationChat.reload}>
              Try again
            </Button>
          }
        />
      );
    }
    if (conversationChat.loading || landingConversation) {
      return (
        <LoadingState
          className="h-full bg-charcoal-bg"
          label={`Opening ${socialProviderLabel(provider)}`}
          title={`Opening ${socialProviderLabel(provider)}`}
        />
      );
    }
    if (provider !== "misty" && connectionsError) {
      return (
        <ErrorState
          className="h-full bg-charcoal-bg"
          title={`${socialProviderLabel(provider)} needs attention`}
          description={connectionsError}
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadConnections({ force: true })}
            >
              Try again
            </Button>
          }
        />
      );
    }
    if (
      provider !== "misty" &&
      user?.id &&
      (connectionsAccountId !== user.id || connectionsLoading)
    ) {
      return (
        <LoadingState
          className="h-full bg-charcoal-bg"
          label={`Checking ${socialProviderLabel(provider)}`}
          title={`Checking ${socialProviderLabel(provider)}`}
        />
      );
    }
    return (
      <EmptyState
        className="h-full bg-charcoal-bg"
        title={
          provider === "misty"
            ? "No Misty conversations yet"
            : providerConnected
              ? `No ${socialProviderLabel(provider)} conversations yet`
              : `Connect ${socialProviderLabel(provider)}`
        }
        description={
          provider === "misty"
            ? "Private support conversations will appear here when they’re available."
            : providerConnected
              ? "New synced conversations will open here when they arrive."
              : `Connect your ${socialProviderLabel(provider)} account to bring its conversations into Social.`
        }
        action={
          provider === "misty" ? (
            <Button type="button" variant="outline" onClick={conversationChat.reload}>
              Refresh
            </Button>
          ) : providerConnected ? (
            <Button type="button" variant="outline" onClick={conversationChat.reload}>
              Refresh
            </Button>
          ) : (
            <Button
              type="button"
              disabled={authorizingProvider === provider}
              onClick={() => void connectProvider()}
            >
              {authorizingProvider === provider
                ? "Connecting…"
                : `Connect ${socialProviderLabel(provider)}`}
            </Button>
          )
        }
      />
    );
  }

  if (conversationId && conversationChat.error && !scope.activeConversation) {
    return (
      <ErrorState
        className="h-full bg-charcoal-bg"
        title="Conversation couldn’t load"
        description={conversationChat.error}
        action={
          <Button type="button" variant="outline" onClick={conversationChat.reload}>
            Try again
          </Button>
        }
      />
    );
  }

  if (conversationId && conversationChat.loading && !scope.activeConversation) {
    return (
      <LoadingState
        className="h-full bg-charcoal-bg"
        label={`Opening ${socialProviderLabel(provider)} conversation`}
        title={`Opening ${socialProviderLabel(provider)} conversation`}
      />
    );
  }

  if (!activeProviderConversation) {
    return (
      <EmptyState
        className="h-full bg-charcoal-bg"
        title={`Conversation isn’t available in ${socialProviderLabel(provider)}`}
        description={`Choose a ${socialProviderLabel(provider)} conversation from Social instead.`}
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(socialProviderPath(spaceId, provider), { replace: true })}
          >
            Back to {socialProviderLabel(provider)}
          </Button>
        }
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg text-cream">
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5">
        <h1 className="m-0 shrink-0 text-sm font-semibold">
          {scope.activeConversation?.title || "Everyone"}
        </h1>

        <div className="ml-auto flex items-center gap-3">
          {conversationId && !scope.activeConversation?.direct_agent_id ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-cream-muted"
              aria-label={
                suggestionVeto
                  ? "Resume action suggestions"
                  : "Pause action suggestions in this conversation"
              }
              title={suggestionVeto ? "Resume suggestions" : "Pause suggestions"}
              onClick={() => void toggleSuggestionVeto()}
            >
              {suggestionVeto ? (
                <LightbulbOff className="size-4" />
              ) : (
                <Lightbulb className="size-4" />
              )}
            </Button>
          ) : null}
          <ChatPresencePill spaceId={spaceId} />
        </div>
      </header>

      {!conversationId ? (
        <SpaceSetupCards
          spaceId={spaceId}
          isOwner={access.isOwner}
          showInvitation={searchParams.get("created") === "1"}
          dismissible
        />
      ) : null}

      <SpaceChatThread
        spaceId={spaceId}
        access={access}
        scope={scope}
        store={store}
        editing={editing}
        actions={actions}
        suggestions={suggestions}
        currentUserId={user?.id}
        error={messagesError}
        setError={conversationChat.setError}
        loading={messagesLoading}
        endRef={endRef}
        scrollRef={chatScroll.scrollRef}
        onScroll={chatScroll.onScroll}
        onOpenPicker={openPicker}
        onBeginMention={input.beginMention}
        onReply={draft.setReplyToMessageId}
        onDelete={setMessageToDelete}
        pendingAgentRuns={agentTurns.pending}
        actionSuggestions={actionSuggestions.items}
        onActionSuggestionsChanged={() => void actionSuggestions.refresh()}
        onReload={() => {
          if (conversationId) conversationChat.reload();
          else void store.loadMessages(spaceId);
        }}
      />

      {access.canWriteMessages ? (
        <SpaceChatComposer
          draft={draft}
          suggestions={suggestions}
          input={input}
          isConversation={Boolean(conversationId)}
          canUploadAttachments={access.canUploadAttachments}
          canBrowseLibrary={access.canBrowseLibrary}
          mentionNames={mentionNames}
          replyToSenderName={
            scope.messages.find((item) => item.id === draft.replyToMessageId)?.sender_name ??
            "message"
          }
          onSubmit={(event) => void actions.submit(event)}
          onOpenPicker={openPicker}
        />
      ) : (
        <ChatReadOnlyNotice />
      )}

      {pickerOpen ? (
        <SpaceChatPicker
          spaceId={spaceId}
          source={pickerSource}
          selectedLibraryIds={draft.selectedLibraryIds}
          pendingAttachmentCount={draft.pendingAttachments.length}
          canBrowseLibrary={access.canBrowseLibrary}
          canUploadAttachments={access.canUploadAttachments}
          onClose={() => setPickerOpen(false)}
          onChooseFiles={(paths) => void draft.uploadAttachments(paths)}
          onChooseLibraryItems={draft.setSelectedLibraryIds}
        />
      ) : null}

      <DeleteMessageDialog
        open={Boolean(messageToDelete)}
        onOpenChange={(open) => {
          if (!open) setMessageToDelete(null);
        }}
        onConfirm={() => {
          if (!messageToDelete) return;
          void actions.remove(messageToDelete).then((removed) => {
            if (removed) setMessageToDelete(null);
          });
        }}
      />
    </div>
  );
}

export function shouldShowSocialConversation(
  provider: SocialProviderId,
  conversationId: string,
  conversationProvider: string | undefined,
): boolean {
  if (!conversationId) return provider === "misty";
  return conversationProvider === provider;
}

export function shouldOpenMistySupportConversation(
  spaceKind: string | undefined,
  conversationId: string,
  provider: SocialProviderId,
): boolean {
  return spaceKind === "misty" && !conversationId && provider === "misty";
}

export function socialLandingConversation(
  provider: SocialProviderId,
  spaceKind: string | undefined,
  conversations: Array<{
    id: string;
    kind?: string;
    origin?: string;
    direct_agent_id?: string;
  }>,
) {
  if (provider === "misty") {
    if (spaceKind !== "misty") return undefined;
    return conversations.find(
      (conversation) => conversation.kind === "misty_support" && !conversation.direct_agent_id,
    );
  }
  return conversations.find(
    (conversation) => conversation.origin === provider && !conversation.direct_agent_id,
  );
}

function socialProviderLabel(provider: SocialProviderId): string {
  if (provider === "x") return "X";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export const SpaceChat = SpaceSocial;
