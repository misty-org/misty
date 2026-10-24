import type { MistyPickerSource } from "@/features/picker";
import { useAuth } from "@/features/auth";
import { useNativeSessionStore } from "@/features/native-session";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { useWorkspaceViewTitle } from "@/features/workspace";
import { SpaceSetupCards } from "../components/SpaceSetupCards";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { spaceChatPath } from "./chatRoute";
import { DeleteMessageDialog } from "./components/ChatMessages";
import { conversationName } from "./sidebar/conversationGroups";
import { SpaceChatComposerArea } from "./components/SpaceChatComposerArea";
import { SpaceChatThread } from "./components/SpaceChatThread";
import { useChatScrollRestoration } from "./hooks/useChatScrollRestoration";
import { useChatSuggestions } from "./hooks/useChatSuggestions";
import { useComposerInput } from "./hooks/useComposerInput";
import { useMessageDeleteTarget } from "./hooks/useMessageDeleteTarget";
import { useMessageEditing } from "./hooks/useMessageEditing";
import { useSpaceChatScope, useSpaceChatStore } from "./hooks/useSpaceChatData";
import { useSpaceChatMessageActions } from "./hooks/useSpaceChatMessageActions";
import { useSpaceChatAccess } from "./hooks/useSpaceChatAccess";
import { useSpaceChatTyping } from "./hooks/useSpaceChatTyping";
import { useSpaceConversationChat } from "./hooks/useSpaceConversationChat";
import { useSpaceChatAiAdapter } from "./hooks/useSpaceChatAiAdapter";
import { useChatReadReceipts } from "./hooks/useChatReadReceipts";
import {
  ChatTitleBar,
  ConversationLoadState,
  ConversationUnavailable,
} from "./components/ConversationStates";
import { useSpaceAgentMembers } from "../members/agents/useSpaceAgentMembers";
import { ChatThreadColumn } from "./components/ChatThreadColumn";
import { AgentTranscriptCard } from "./components/AgentTranscriptButton";
import { useChatSidePanel } from "./store/chatSidePanelStore";
export function SpaceChat({
  spaceId,
  spaceName,
  workspaceTabId,
  conversationId: openConversationId,
  panel = false,
  onBack,
}: {
  spaceId: string;
  spaceName: string;
  workspaceTabId?: string;
  /** The chat to show instead of the page's `conversation` parameter, as the side panel does. */
  conversationId?: string;
  /** In the side panel the header switcher names the chat, so no title row is drawn. */
  panel?: boolean;
  /** Where "Back to Chat" goes when the open chat is gone; defaults to the chat page. */
  onBack?: () => void;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const setupUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const user = authUser ?? setupUser;
  const conversationId = openConversationId ?? searchParams.get("conversation") ?? "";
  const chatRootRef = useRef<HTMLDivElement>(null);
  const threadRootId = useChatSidePanel((panel) => panel.threadRootId);
  const transcriptRequestId = useChatSidePanel((panel) => panel.transcriptRequestId);
  // Panels belong to the chat they were opened in.
  useEffect(() => useChatSidePanel.getState().reset(), [spaceId, conversationId]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const store = useSpaceChatStore();
  const conversationChat = useSpaceConversationChat(spaceId, conversationId);
  const scope = useSpaceChatScope({
    spaceId,
    conversationId,
    currentUserId: user?.id,
    conversations: conversationChat.conversations,
    conversationMessages: conversationChat.messages,
    store,
  });
  const access = useSpaceChatAccess(spaceId);
  const typing = useSpaceChatTyping({
    spaceId,
    conversationId,
    currentUserId: user?.id,
    members: scope.members,
  });
  useWorkspaceViewTitle(workspaceTabId, `${spaceName} Chat`);
  const draft = useSpaceChatDraft(spaceId, conversationId);
  const editing = useMessageEditing();
  const { agents } = useSpaceAgentMembers(spaceId);
  const suggestions = useChatSuggestions({
    spaceId,
    members: scope.members,
    agents,
    currentUserId: user?.id,
    canBrowseLibrary: access.canWriteMessages,
    canReadLibrary: true,
    selectedLibraryIds: draft.selectedLibraryIds,
    attachmentSlotsLeft: draft.attachmentSlotsLeft,
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<MistyPickerSource>("files");
  const deleting = useMessageDeleteTarget([user?.id, spaceId, conversationId]);
  const messageToDelete = deleting.message;
  const clearDeleteTarget = deleting.clear;
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
    canUploadAttachments: access.canWriteMessages,
    canBrowseLibrary: access.canWriteMessages,
    openPicker,
  });
  const actions = useSpaceChatMessageActions({
    spaceId,
    conversationId,
    currentUser: user ? { id: user.id, name: user.username } : undefined,
    activeConversation: scope.activeConversation,
    members: scope.members,
    agents,
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
  useSpaceChatAiAdapter({
    spaceId,
    conversationId,
    available: conversationAvailable,
    canWrite: access.canWriteMessages,
    title: scope.activeConversation?.title,
    messages: scope.messages,
    draft,
  });
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
    clearDeleteTarget();
    closeSuggestions(false);
    setPickerOpen(false);
    clearSpacesError();
  }, [
    clearDeleteTarget,
    clearSpacesError,
    closeSuggestions,
    resetEditing,
    conversationId,
    spaceId,
    store.referenceOnly,
    user?.id,
  ]);
  useChatReadReceipts({
    spaceId,
    conversationId,
    enabled: conversationAvailable && !store.referenceOnly,
    messages: scope.messages,
    markSpaceRead: markRead,
  });
  if (
    conversationId &&
    !scope.activeConversation &&
    (conversationChat.error || conversationChat.loading)
  )
    return (
      <ConversationLoadState error={conversationChat.error} onRetry={conversationChat.reload} />
    );
  if (!conversationAvailable)
    return (
      <ConversationUnavailable
        onBack={() => (onBack ? onBack() : navigate(spaceChatPath(spaceId), { replace: true }))}
      />
    );
  return (
    <div
      ref={chatRootRef}
      className="relative flex h-full min-h-0 overflow-hidden bg-charcoal-bg text-cream"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {panel ? null : (
          <ChatTitleBar
            title={
              scope.activeConversation
                ? conversationName(scope.activeConversation, user?.id)
                : "Everyone"
            }
          />
        )}

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
          onDelete={deleting.request}
          onReload={() => {
            if (conversationId) conversationChat.reload();
            else void store.loadMessages(spaceId);
          }}
        />

        <SpaceChatComposerArea
          spaceId={spaceId}
          canWrite={access.canWriteMessages}
          isConversation={Boolean(conversationId)}
          draft={draft}
          suggestions={suggestions}
          input={input}
          typing={typing}
          members={scope.members}
          agents={agents}
          messages={scope.messages}
          pickerOpen={pickerOpen}
          pickerSource={pickerSource}
          onOpenPicker={openPicker}
          onClosePicker={() => setPickerOpen(false)}
          onSubmit={(event) => void actions.submit(event)}
        />

        <DeleteMessageDialog
          open={Boolean(messageToDelete)}
          onOpenChange={(open) => {
            if (!open) deleting.clear();
          }}
          onConfirm={() => {
            if (!messageToDelete) return;
            void actions.remove(messageToDelete).then((removed) => {
              if (removed) deleting.clear();
            });
          }}
        />
      </div>
      {threadRootId ? (
        <ChatThreadColumn
          rootId={threadRootId}
          messages={scope.messages}
          canWrite={access.canWriteMessages}
          typingLabel={typing.label}
          onTypingInput={typing.onTextInput}
          onStopTyping={typing.stop}
          onSend={actions.sendReply}
        />
      ) : null}
      {transcriptRequestId ? <AgentTranscriptCard requestId={transcriptRequestId} /> : null}
    </div>
  );
}
