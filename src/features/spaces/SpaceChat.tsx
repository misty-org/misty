export type { ChatComposerSuggestion } from "@/models/types/features/spaces/SpaceChat";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MessagesSquare } from "lucide-react";

import { useAuth } from "@/features/auth/AuthContext";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { useSetupStore } from "@/stores/app";
import { mergeSpaceMessages } from "@/stores/spaces/useSpaceMessageSpansStore";
import type { MistyPickerSource } from "@/models/interfaces/features/picker/MistyPicker";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";
import { useSpaceConversationChat } from "./useSpaceConversationChat";
import { useDiscordPublish } from "./connections";
import { DeleteMessageDialog } from "./components/SpaceChatMessages";
import { SpaceSetupCards } from "./components/SpaceSetupCards";
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

export function SpaceChat({ spaceId }: { spaceId: string }) {
  const [searchParams] = useSearchParams();
  const { user: authUser } = useAuth();
  const setupUser = useSetupStore((state) => state.status?.current_user ?? null);
  const user = authUser ?? setupUser;
  const conversationId = searchParams.get("conversation") ?? "";
  const endRef = useRef<HTMLDivElement | null>(null);

  const access = useSpaceChatPermissions(spaceId);
  const store = useSpaceChatStore();
  const conversationChat = useSpaceConversationChat(
    spaceId,
    conversationId,
    access.canReadMessages,
  );
  const scope = useSpaceChatScope({
    spaceId,
    conversationId,
    currentUserId: user?.id,
    conversations: conversationChat.conversations,
    conversationMessages: conversationChat.messages,
    store,
  });

  const draft = useSpaceChatDraft(spaceId);
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
  });

  const [messagesLoading] = useMinimumSpin(
    conversationId ? conversationChat.loading : store.loading && scope.defaultMessages.length === 0,
  );

  // Switching Space (or identity) abandons anything staged in the composer.
  useEffect(() => {
    draft.reset();
    editing.reset();
    suggestions.setOpen(false);
    setPickerOpen(false);
    store.clearSpacesError();
    void store.loadChatAgents(spaceId);
  }, [spaceId, user?.id]);

  useEffect(() => {
    const messageId = searchParams.get("message");
    const target = messageId ? document.getElementById(`message-${messageId}`) : endRef.current;
    target?.scrollIntoView({ block: messageId ? "center" : "end" });
    const last = scope.messages[scope.messages.length - 1];
    if (last && !conversationId) void store.markRead(spaceId, last.seq);
  }, [conversationId, scope.messages, searchParams, spaceId]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="misty-spaces-toolbar flex h-11 shrink-0 items-center gap-2.5 px-3">
        <span className="grid size-7 shrink-0 place-items-center text-muted-foreground">
          <MessagesSquare size={16} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <h1 className="truncate text-[13px] font-semibold leading-tight">
            {conversationId ? scope.activeConversation?.title || "Conversation" : "Everyone"}
          </h1>
        </span>
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
        onOpenPicker={openPicker}
        onBeginMention={input.beginMention}
        onReply={draft.setReplyToMessageId}
        onDelete={setMessageToDelete}
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
