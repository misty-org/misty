import type { RefObject } from "react";
import { SpaceChatMessages } from "../components/SpaceChatMessages";
import type { MistyPickerSource } from "@/models/interfaces/features/picker/MistyPicker";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";
import type { SpaceChatPermissions } from "./useSpaceChatPermissions";
import type { MessageEditingState } from "./useMessageEditing";
import type { ChatSuggestionsState } from "./useChatSuggestions";
import type { useSpaceChatMessageActions } from "./useSpaceChatMessageActions";
import type { useSpaceChatScope, useSpaceChatStore } from "./useSpaceChatData";

export interface SpaceChatThreadProps {
  spaceId: string;
  access: SpaceChatPermissions;
  scope: ReturnType<typeof useSpaceChatScope>;
  store: ReturnType<typeof useSpaceChatStore>;
  editing: MessageEditingState;
  actions: ReturnType<typeof useSpaceChatMessageActions>;
  suggestions: ChatSuggestionsState;
  discord: { publishingMessageId: string; publish: (message: SpaceMessage) => void };
  currentUserId: string | undefined;
  error: string;
  setError: (message: string) => void;
  loading: boolean;
  endRef: RefObject<HTMLDivElement | null>;
  onOpenPicker: (source: MistyPickerSource) => void;
  onBeginMention: () => void;
  onReply: (messageId: string) => void;
  onDelete: (message: SpaceMessage) => void;
}

/** The scrolling message list, wired to the Space's data and message actions. */
export function SpaceChatThread(props: SpaceChatThreadProps) {
  const { spaceId, access, scope, store, editing, actions, suggestions } = props;

  return (
    <SpaceChatMessages
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
      onEditingText={editing.setEditingText}
      onCancelEditing={editing.cancel}
      onSaveEdited={(event, message) => void actions.saveEdited(event, message)}
      onReply={props.onReply}
      onToggleReaction={(message, emoji, reacted) =>
        void actions.toggleReaction(message, emoji, reacted)
      }
      onBeginEditing={editing.begin}
      onDelete={props.onDelete}
      publishingMessageId={props.discord.publishingMessageId}
      onPublishToDiscord={(message) => props.discord.publish(message)}
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
    />
  );
}
