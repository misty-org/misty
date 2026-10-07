import { readApiSessionGeneration } from "@/api/client/session";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { type AiArtifact, type AiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { SpaceChatPicker } from "@/features/chat-composer/SpaceChatPicker";
import type { MistyPickerSource } from "@/features/picker";
import {
  socialApi as spacesApi,
  useSocialAi as useAiSurfaceAdapter,
  useSocialAuth as useAuth,
  useSocialSetup as useNativeSessionStore,
  useSocialDraft as useSpaceChatDraft,
  useSocialTitle as useWorkspaceViewTitle,
} from "./SocialRuntime";
import { SpaceSetupCards } from "../components/SpaceSetupCards";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { spaceChatConversationPath, spaceChatPath } from "./chatRoute";
import { DeleteMessageDialog } from "./components/ChatMessages";
import { ConversationSwitcher } from "./components/ConversationSwitcher";
import { ChatPresencePill } from "./components/ChatPresencePill";
import { ChatReadOnlyNotice } from "./components/ChatReadOnlyNotice";
import { SpaceChatComposer } from "./components/SpaceChatComposer";
import { SpaceChatThread } from "./components/SpaceChatThread";
import { useChatScrollRestoration } from "./hooks/useChatScrollRestoration";
import { useChatSuggestions } from "./hooks/useChatSuggestions";
import { useComposerInput } from "./hooks/useComposerInput";
import { useMessageEditing } from "./hooks/useMessageEditing";
import { useSpaceChatScope, useSpaceChatStore } from "./hooks/useSpaceChatData";
import { useSpaceChatMessageActions } from "./hooks/useSpaceChatMessageActions";
import { useSpaceChatPermissions } from "./hooks/useSpaceChatPermissions";
import { useSpaceConversationChat } from "./hooks/useSpaceConversationChat";
import { spaceChatSuggestedActions } from "./spaceChatAiActions";
export function SpaceSocial({
  spaceId,
  spaceName,
  workspaceTabId,
}: {
  spaceId: string;
  spaceName: string;
  workspaceTabId?: string;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const setupUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const user = authUser ?? setupUser;
  const conversationId = searchParams.get("conversation") ?? "";
  const chatRootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastReadReceiptRef = useRef("");
  const initialAccess = useSpaceChatPermissions(spaceId, conversationId);
  const store = useSpaceChatStore();
  const conversationChat = useSpaceConversationChat(
    spaceId,
    conversationId,
    initialAccess.canReadMessages,
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
  useWorkspaceViewTitle(workspaceTabId, `${spaceName} Chat`);
  const draft = useSpaceChatDraft(spaceId, conversationId);
  const editing = useMessageEditing();
  const suggestions = useChatSuggestions({
    spaceId,
    members: scope.members,
    currentUserId: user?.id,
    canBrowseLibrary: access.canBrowseLibrary,
    canReadLibrary: access.permissions?.["library.view"] !== false,
    selectedLibraryIds: draft.selectedLibraryIds,
    attachmentSlotsLeft: draft.attachmentSlotsLeft,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<MistyPickerSource>("files");
  const deleteScope = JSON.stringify([
    readApiSessionGeneration(),
    user?.id,
    spaceId,
    conversationId,
  ]);
  const [deleteTarget, setDeleteTarget] = useState<{ scope: string; message: SpaceMessage } | null>(
    null,
  );
  const messageToDelete = deleteTarget?.scope === deleteScope ? deleteTarget.message : null;
  const resetEditing = editing.reset;
  const closeSuggestions = suggestions.setOpen;
  const clearSpacesError = store.clearSpacesError;
  const markRead = store.markRead;
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
    () => [...scope.members.map((member) => member.name)],
    [scope.members],
  );
  const actions = useSpaceChatMessageActions({
    spaceId,
    conversationId,
    currentUser: user
      ? {
          id: user.id,
          name: user.name,
        }
      : undefined,
    activeConversation: scope.activeConversation,
    members: scope.members,
    draft,
    editing,
    setGroupMessages: conversationChat.setMessages,
    setGroupChatError: conversationChat.setError,
    storeSendMessage: store.sendMessage,
    storeUpdateMessage: store.updateMessage,
    storeDeleteMessage: store.deleteMessage,
    storeToggleReaction: store.toggleMessageReaction,
  });
  const messagesLoading = conversationId
    ? conversationChat.loading && conversationChat.messages.length === 0
    : (store.messageLoadingBySpace[spaceId] ?? store.loading) && scope.defaultMessages.length === 0;
  const messagesError = conversationId
    ? conversationChat.error
    : (store.messageErrorsBySpace[spaceId] ?? "");
  const conversationAvailable = !conversationId || Boolean(scope.activeConversation);
  const draftText = draft.text;
  const setDraftText = draft.setText;
  const setDraftReplyToMessageId = draft.setReplyToMessageId;
  const aiAdapter = useMemo<AiSurfaceAdapter | null>(() => {
    if (!conversationAvailable) return null;
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
            ? spaceChatConversationPath(spaceId, conversationId)
            : spaceChatPath(spaceId),
          revision: scope.messages[scope.messages.length - 1]?.seq ?? 0,
        },
      ],
      getSuggestedActions: () => spaceChatSuggestedActions,
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
    conversationAvailable,
    conversationId,
    draftText,
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
    targetMessageId: searchParams.get("message") ?? undefined,
  });

  // Transient menus close on navigation; drafts remain scoped to their conversation.
  useEffect(() => {
    resetEditing();
    setDeleteTarget(null);
    closeSuggestions(false);
    setPickerOpen(false);
    clearSpacesError();
  }, [
    clearSpacesError,
    closeSuggestions,
    resetEditing,
    conversationId,
    spaceId,
    store.referenceOnly,
    user?.id,
  ]);
  useEffect(() => {
    if (!conversationAvailable) return;
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
    conversationAvailable,
    conversationId,
    markRead,
    scope.messages,
    spaceId,
    store.referenceOnly,
  ]);
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
        label="Opening conversation"
        title="Opening conversation"
      />
    );
  }
  if (!conversationAvailable) {
    return (
      <EmptyState
        className="h-full bg-charcoal-bg"
        title="Conversation isn’t available"
        description="Choose another conversation from Chat."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              navigate(spaceChatPath(spaceId), {
                replace: true,
              })
            }
          >
            Back to Chat
          </Button>
        }
      />
    );
  }
  return (
    <div
      ref={chatRootRef}
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg text-cream"
    >
      <header
        className={
          "flex min-h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5"
        }
      >
        <ConversationSwitcher
          spaceId={spaceId}
          conversation={scope.activeConversation}
          currentUserId={user?.id}
          members={scope.allMembers}
          canWrite={access.canWriteMessages}
        />
        <ChatPresencePill spaceId={spaceId} />
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
        onReply={(id) => {
          draft.setReplyToMessageId(id);
          requestAnimationFrame(() => chatRootRef.current?.querySelector("textarea")?.focus());
        }}
        onDelete={(message) => setDeleteTarget({ scope: deleteScope, message })}
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
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!messageToDelete) return;
          void actions.remove(messageToDelete).then((removed) => {
            if (removed) setDeleteTarget(null);
          });
        }}
      />
    </div>
  );
}
