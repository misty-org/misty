import type { MistyPickerSource } from "@/features/picker";
import type { SpaceActionSuggestionBatch, SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import type { RefObject, UIEventHandler } from "react";
import type { ChatSuggestionsState } from "../hooks/useChatSuggestions";
import type { MessageEditingState } from "../hooks/useMessageEditing";
import type { PendingAgentRun } from "../hooks/usePendingAgentRuns";
import type { useSpaceChatScope, useSpaceChatStore } from "../hooks/useSpaceChatData";
import type { useSpaceChatMessageActions } from "../hooks/useSpaceChatMessageActions";
import type { SpaceChatPermissions } from "../hooks/useSpaceChatPermissions";
import { SpaceChatMessages } from "./ChatMessages";

export interface SpaceChatThreadProps {
  spaceId: string;
  access: SpaceChatPermissions;
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
  onOpenPicker: (source: MistyPickerSource) => void;
  onBeginMention: () => void;
  onReply: (messageId: string) => void;
  onDelete: (message: SpaceMessage) => void;
  pendingAgentRuns: PendingAgentRun[];
  actionSuggestions: SpaceActionSuggestionBatch[];
  onActionSuggestionsChanged: () => void;
  onPublishToDiscord: (message: SpaceMessage) => void;
  canPublishToDiscord: (message: SpaceMessage) => boolean;
  publishingMessageId: string;
  onPublishToSlack: (message: SpaceMessage) => void;
  canPublishToSlack: (message: SpaceMessage) => boolean;
  publishingSlackMessageId: string;
}

/** The scrolling message list, wired to the Space's data and message actions. */
export function SpaceChatThread(props: SpaceChatThreadProps) {
  const { spaceId, access, scope, store, editing, actions, suggestions } = props;

  return (
    <SpaceChatMessages
      error={props.error}
      loading={props.loading}
      messages={scope.messages}
      pendingAgentRuns={props.pendingAgentRuns}
      actionSuggestions={props.actionSuggestions}
      onActionSuggestionsChanged={props.onActionSuggestionsChanged}
      currentUserId={props.currentUserId}
      isOwner={access.isOwner}
      canWrite={access.canWriteMessages}
      editingMessageId={editing.editingMessageId}
      editingText={editing.editingText}
      editSaving={editing.editSaving}
      nodes={scope.nodes}
      libraryItems={suggestions.libraryItems}
      canCopyLibrary={access.canCopyLibrary}
      canAddToLibrary={access.canAddToLibrary}
      spaceId={spaceId}
      spaceName={scope.activeConversation?.title || access.activeSpace?.name}
      directRecipient={scope.directRecipient}
      onStarter={(starter) => {
        if (starter === "files" || starter === "library") return props.onOpenPicker(starter);
        props.onBeginMention();
      }}
      endRef={props.endRef}
      scrollRef={props.scrollRef}
      onScroll={props.onScroll}
      onEditingText={editing.setEditingText}
      onCancelEditing={editing.cancel}
      onSaveEdited={(event, message) => void actions.saveEdited(event, message)}
      onReply={props.onReply}
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
      onLibraryItem={(item) =>
        suggestions.setLibraryItems((current) => [
          ...current.filter((candidate) => candidate.id !== item.id),
          item,
        ])
      }
      onReload={() => void store.loadMessages(spaceId)}
      onPublishToDiscord={props.onPublishToDiscord}
      canPublishToDiscord={props.canPublishToDiscord}
      publishingMessageId={props.publishingMessageId}
      onPublishToSlack={props.onPublishToSlack}
      canPublishToSlack={props.canPublishToSlack}
      publishingSlackMessageId={props.publishingSlackMessageId}
    />
  );
}
