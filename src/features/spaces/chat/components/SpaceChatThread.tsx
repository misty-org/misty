import type { MistyPickerSource } from "@/features/files";
import type { SpaceMessage } from "../../api/dto/entities";
import type { RefObject, UIEventHandler } from "react";
import type { ChatSuggestionsState } from "../hooks/use_chat_suggestions";
import type { MessageEditingState } from "../hooks/use_message_editing";
import type { useSpaceChatScope, useSpaceChatStore } from "../hooks/use_space_chat_data";
import type { useSpaceChatMessageActions } from "../hooks/use_space_chat_message_actions";
import type { SpaceChatAccess } from "../hooks/use_space_chat_access";
import type { SpaceChatMessagesProps } from "./ChatMessages";
import { ChatMessageList } from "./ChatMessageList";

export interface SpaceChatThreadProps extends Pick<
  SpaceChatMessagesProps,
  "memberColors" | "myRoleIds" | "canManageMessages" | "firstUnreadId" | "channel" | "welcome"
> {
  spaceId: string;
  access: SpaceChatAccess;
  scope: ReturnType<typeof useSpaceChatScope>;
  store: ReturnType<typeof useSpaceChatStore>;
  editing: MessageEditingState;
  actions: ReturnType<typeof useSpaceChatMessageActions>;
  suggestions: ChatSuggestionsState;
  currentUserId: string | undefined;
  error: string;
  setError: (message: string) => void;
  loading: boolean;
  endRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  hasOlderMessages: boolean;
  onJumpToMessage: (messageId: string) => void;
  onOpenPicker: (source: MistyPickerSource) => void;
  onBeginMention: () => void;
  onReply: (messageId: string) => void;
  onDelete: (message: SpaceMessage) => void;
  onReload: () => void;
}

export function SpaceChatThread(props: SpaceChatThreadProps) {
  const { spaceId, access, scope, store, editing, actions } = props;

  return (
    <ChatMessageList
      error={props.error}
      loading={props.loading}
      messages={scope.messages}
      currentUserId={props.currentUserId}
      isOwner={access.isOwner}
      canWrite={access.canWriteMessages}
      editingMessageId={editing.editingMessageId}
      editingText={editing.editingText}
      editSaving={editing.editSaving}
      nodes={scope.nodes}
      spaceId={spaceId}
      directRecipient={scope.directRecipient}
      memberColors={props.memberColors}
      myRoleIds={props.myRoleIds}
      canManageMessages={props.canManageMessages}
      firstUnreadId={props.firstUnreadId}
      channel={props.channel}
      welcome={props.welcome}
      onStarter={(starter) => {
        if (starter === "files" || starter === "space") return props.onOpenPicker(starter);
        props.onBeginMention();
      }}
      endRef={props.endRef}
      scrollRef={props.scrollRef}
      onScroll={props.onScroll}
      hasOlderMessages={props.hasOlderMessages}
      onJumpToMessage={props.onJumpToMessage}
      onEditingText={editing.setEditingText}
      onCancelEditing={editing.cancel}
      onSaveEdited={(event, message) => void actions.saveEdited(event, message)}
      onReply={props.onReply}
      onRetry={access.canWriteMessages ? (message) => void actions.retry(message) : undefined}
      onToggleReaction={(message, emoji, reacted) =>
        void actions.toggleReaction(message, emoji, reacted)
      }
      onBeginEditing={editing.begin}
      onDelete={props.onDelete}
      onOpenNode={(nodeId) => {
        void store.openNode(spaceId, nodeId).catch((error: unknown) => {
          props.setError(error instanceof Error ? error.message : "This file could not be opened.");
        });
      }}
      onError={props.setError}
      onReload={props.onReload}
    />
  );
}
