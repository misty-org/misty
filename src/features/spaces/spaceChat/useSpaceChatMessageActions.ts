import type { Dispatch, FormEvent, SetStateAction } from "react";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { mergeSpaceMessages } from "@/stores/spaces/useSpaceMessageSpansStore";
import { buildMessageSpans } from "@/stores/spaces/useSpacesStore";
import type {
  SpaceConversation,
  SpaceMember,
  SpaceMessage,
  SpaceStudioResource,
} from "@/models/interfaces/features/spaces/types";
import type { SpaceChatDraft } from "./useSpaceChatDraft";
import type { MessageEditingState } from "./useMessageEditing";

export interface SpaceChatMessageActionsOptions {
  spaceId: string;
  conversationId: string;
  activeConversation: SpaceConversation | undefined;
  members: SpaceMember[];
  agents: SpaceStudioResource[];
  draft: SpaceChatDraft;
  editing: MessageEditingState;
  setGroupMessages: Dispatch<SetStateAction<SpaceMessage[]>>;
  setGroupChatError: (message: string) => void;
  onPublishToDiscord: (message: SpaceMessage) => void;
  canPublishToDiscord: (message: SpaceMessage) => boolean;
  storeSendMessage: (
    spaceId: string,
    text: string,
    fileIds: string[],
    attachmentIds: string[],
    libraryIds: string[],
    replyToMessageId: string,
    agentIdsByLabel: Record<string, string>,
  ) => Promise<unknown>;
  storeUpdateMessage: (
    spaceId: string,
    messageId: string,
    text: string,
    fileNodeIds: string[],
  ) => Promise<unknown>;
  storeDeleteMessage: (spaceId: string, messageId: string) => Promise<unknown>;
  /** Starts the typing indicator without waiting for the queued run event. */
  onAgentRunsQueued: (runs: SpaceMessage["triggered_runs"]) => void;
  storeToggleReaction: (
    spaceId: string,
    messageId: string,
    emoji: string,
    reacted: boolean,
  ) => Promise<unknown>;
}

/**
 * Send, edit, delete and react — for both Space-wide chat and conversations.
 *
 * Conversations go straight to the API and merge the result into local state;
 * Space-wide chat goes through the Spaces store, which already reports its own
 * errors. That asymmetry is why only the conversation paths set an error here.
 */
export function useSpaceChatMessageActions(options: SpaceChatMessageActionsOptions) {
  const { spaceId, conversationId, members, agents, draft, editing } = options;
  const { setGroupMessages, setGroupChatError } = options;

  const reportConversationError = (error: unknown, fallback: string) => {
    if (conversationId) setGroupChatError(error instanceof Error ? error.message : fallback);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (draft.isEmpty) return;
    const value = draft.text.trim();
    const attachmentIds = draft.pendingAttachments.map((item) => item.id);
    try {
      if (conversationId) {
        const response = await spacesApi.sendConversationMessage(
          spaceId,
          conversationId,
          buildMessageSpans(value, members, agents, draft.selectedAgentIdsByLabel),
          draft.selectedFileIds,
          attachmentIds,
          draft.selectedLibraryIds,
          draft.replyToMessageId,
        );
        response.message.triggered_runs = (response.triggered_runs ?? []).map((run) => ({
          ...run,
          state: run.state as NonNullable<SpaceMessage["triggered_runs"]>[number]["state"],
        }));
        setGroupMessages((current) => mergeSpaceMessages(current, [response.message]));
        options.onAgentRunsQueued(response.message.triggered_runs);
        if (
          options.activeConversation?.origin === "discord" &&
          options.canPublishToDiscord(response.message)
        ) {
          options.onPublishToDiscord(response.message);
        }
      } else {
        await options.storeSendMessage(
          spaceId,
          value,
          draft.selectedFileIds,
          attachmentIds,
          draft.selectedLibraryIds,
          draft.replyToMessageId,
          draft.selectedAgentIdsByLabel,
        );
      }
      draft.reset();
    } catch (reason) {
      reportConversationError(reason, "The group message could not be sent.");
    }
  };

  const saveEdited = async (event: FormEvent, message: SpaceMessage) => {
    event.preventDefault();
    const value = editing.editingText.trim();
    if (!value || editing.editSaving) return;
    editing.setEditSaving(true);
    try {
      if (conversationId) {
        const saved = await spacesApi.updateConversationMessage(
          spaceId,
          conversationId,
          message.id,
          buildMessageSpans(value, members, agents),
          message.file_node_ids,
        );
        setGroupMessages((current) => mergeSpaceMessages(current, [saved]));
      } else {
        await options.storeUpdateMessage(spaceId, message.id, value, message.file_node_ids);
      }
      editing.cancel(message.id);
    } catch (error) {
      reportConversationError(error, "The message could not be saved.");
    } finally {
      editing.setEditSaving(false);
    }
  };

  /** Resolves false when the delete failed, so the dialog can stay open. */
  const remove = async (message: SpaceMessage): Promise<boolean> => {
    try {
      if (conversationId) {
        await spacesApi.deleteConversationMessage(spaceId, conversationId, message.id);
        setGroupMessages((current) => current.filter((item) => item.id !== message.id));
      } else {
        await options.storeDeleteMessage(spaceId, message.id);
      }
      return true;
    } catch (error) {
      reportConversationError(error, "The message could not be deleted.");
      return false;
    }
  };

  const toggleReaction = async (message: SpaceMessage, emoji: string, reacted: boolean) => {
    try {
      if (conversationId) {
        const saved = reacted
          ? await spacesApi.removeConversationMessageReaction(
              spaceId,
              conversationId,
              message.id,
              emoji,
            )
          : await spacesApi.addConversationMessageReaction(
              spaceId,
              conversationId,
              message.id,
              emoji,
            );
        setGroupMessages((current) => mergeSpaceMessages(current, [saved]));
      } else {
        await options.storeToggleReaction(spaceId, message.id, emoji, reacted);
      }
    } catch (error) {
      reportConversationError(error, "The reaction could not be updated.");
    }
  };

  return { submit, saveEdited, remove, toggleReaction };
}
