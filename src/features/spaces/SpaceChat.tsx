export type { ChatComposerSuggestion } from "@/models/types/features/spaces/SpaceChat";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Lightbulb, LightbulbOff, MessagesSquare, Trash2 } from "lucide-react";
import { Button } from "@/ui";

import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { useSetupStore } from "@/stores/app";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { mergeSpaceMessages } from "@/stores/spaces/useSpaceMessageSpansStore";
import type { MistyPickerSource } from "@/models/interfaces/features/picker/MistyPicker";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";
import { useSpaceConversationChat } from "./useSpaceConversationChat";
import { useDiscordPublish } from "./connections";
import { DeleteMessageDialog } from "./components/SpaceChatMessages";
import { SpaceSetupCards } from "./components/SpaceSetupCards";
import { ChatPresencePill } from "./spaceChat/ChatPresencePill";
import { ChatReadOnlyNotice } from "./spaceChat/ChatReadOnlyNotice";
import { SpaceChatComposer } from "./spaceChat/SpaceChatComposer";
import { SpaceChatPicker } from "./spaceChat/SpaceChatPicker";
import { SpaceChatThread } from "./spaceChat/SpaceChatThread";
import { useChatSuggestions } from "./spaceChat/useChatSuggestions";
import { useComposerInput } from "./spaceChat/useComposerInput";
import { useMessageEditing } from "./spaceChat/useMessageEditing";
import { useSpaceChatDraft } from "./spaceChat/useSpaceChatDraft";
import { useSpaceChatMessageActions } from "./spaceChat/useSpaceChatMessageActions";
import { useSpaceChatPermissions } from "./spaceChat/useSpaceChatPermissions";
import { useSpaceChatScope, useSpaceChatStore } from "./spaceChat/useSpaceChatData";
import { usePendingAgentRuns } from "./spaceChat/usePendingAgentRuns";
import { useSpaceActionSuggestions } from "./spaceChat/useSpaceActionSuggestions";
import { useChatScrollRestoration } from "./spaceChat/useChatScrollRestoration";

export function SpaceChat({ spaceId }: { spaceId: string }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const setupUser = useSetupStore((state) => state.status?.current_user ?? null);
  const user = authUser ?? setupUser;
  const conversationId = searchParams.get("conversation") ?? "";
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastReadReceiptRef = useRef("");

  const initialAccess = useSpaceChatPermissions(spaceId, conversationId);
  const store = useSpaceChatStore();
  const conversationChat = useSpaceConversationChat(
    spaceId,
    conversationId,
    initialAccess.canReadMessages,
    initialAccess.activeSpace?.kind === "misty",
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
  const actionSuggestions = useSpaceActionSuggestions(
    spaceId,
    conversationId,
    initialAccess.activeSpace?.kind !== "misty" && !scope.activeConversation?.direct_agent_id,
  );

  useEffect(() => {
    if (initialAccess.activeSpace?.kind !== "misty" || conversationId) return;
    const supportConversation = conversationChat.conversations.find(
      (conversation) => conversation.kind === "misty_support",
    );
    if (!supportConversation) return;
    navigate(
      `/spaces/${encodeURIComponent(spaceId)}/chat?conversation=${encodeURIComponent(supportConversation.id)}`,
      { replace: true },
    );
  }, [
    conversationChat.conversations,
    conversationId,
    initialAccess.activeSpace?.kind,
    navigate,
    spaceId,
  ]);

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

  const discord = useDiscordPublish(spaceId, conversationId, (published) =>
    conversationChat.setMessages((current) => mergeSpaceMessages(current, [published])),
  );
  const actions = useSpaceChatMessageActions({
    spaceId,
    conversationId,
    activeConversation: scope.activeConversation,
    members: scope.members,
    agents: scope.agents,
    draft,
    editing,
    setGroupMessages: conversationChat.setMessages,
    setGroupChatError: conversationChat.setError,
    onPublishToDiscord: (message) => void discord.publish(message),
    canPublishToDiscord: discord.canPublish,
    storeSendMessage: store.sendMessage,
    storeUpdateMessage: store.updateMessage,
    storeDeleteMessage: store.deleteMessage,
    storeToggleReaction: store.toggleMessageReaction,
    onAgentRunsQueued: agentTurns.track,
  });

  const [messagesLoading] = useMinimumSpin(
    conversationId ? conversationChat.loading : store.loading && scope.defaultMessages.length === 0,
  );
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
    draft.reset();
    editing.reset();
    suggestions.setOpen(false);
    setPickerOpen(false);
    store.clearSpacesError();
    if (!store.referenceOnly && initialAccess.activeSpace?.kind !== "misty") {
      void store.loadChatAgents(spaceId);
    }
  }, [initialAccess.activeSpace?.kind, spaceId, user?.id]);

  useEffect(() => {
    const last = scope.messages[scope.messages.length - 1];
    if (!last || store.referenceOnly) return;
    const receiptKey = `${spaceId}:${conversationId || "everyone"}:${last.seq}`;
    if (lastReadReceiptRef.current === receiptKey) return;
    lastReadReceiptRef.current = receiptKey;
    const request = conversationId
      ? spacesApi.markConversationRead(spaceId, conversationId, last.seq)
      : store.markRead(spaceId, last.seq);
    void request.catch(() => {
      if (lastReadReceiptRef.current === receiptKey) lastReadReceiptRef.current = "";
    });
  }, [conversationId, scope.messages, spaceId, store.referenceOnly]);

  const canClearEveryone = !conversationId && access.isOwner;
  const clearChat = async () => {
    if (!window.confirm("Permanently delete every message in Everyone?")) return;
    await spacesApi.clearEveryoneConversation(spaceId);
    await store.loadMessages(spaceId);
  };

  if (initialAccess.activeSpace?.kind === "misty" && !conversationId) {
    return (
      <div className="grid h-full place-items-center bg-charcoal-bg text-sm text-cream-muted">
        Opening your Misty conversation…
      </div>
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
        discord={discord}
        currentUserId={user?.id}
        error={conversationChat.error}
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
      />

      {access.canWriteMessages ? (
        <SpaceChatComposer
          draft={draft}
          suggestions={suggestions}
          input={input}
          isConversation={Boolean(conversationId)}
          sending={store.sending}
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
