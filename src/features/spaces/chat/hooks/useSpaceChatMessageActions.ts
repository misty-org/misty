import { buildMessageSpans } from "@/features/spaces";
import { spacesApi } from "@/api/spaces/api";
import type {
  SpaceConversation,
  SpaceMember,
  SpaceMessage,
  SpaceStudioResource,
} from "@/api/spaces/dto/interfaces/types";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { mergeSpaceMessages } from "../store/useSpaceMessageSpansStore";
import type { MessageEditingState } from "./useMessageEditing";
import type { SpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";

export interface SpaceChatMessageActionsOptions {
  spaceId: string;
  conversationId: string;
  currentUser: { id: string; name: string } | undefined;
  activeConversation: SpaceConversation | undefined;
  members: SpaceMember[];
  agents: SpaceStudioResource[];
  draft: SpaceChatDraft;
  editing: MessageEditingState;
  setGroupMessages: Dispatch<SetStateAction<SpaceMessage[]>>;
  setGroupChatError: (message: string) => void;
  storeSendMessage: (
    spaceId: string,
    text: string,
    fileIds: string[],
    attachmentIds: string[],
    libraryIds: string[],
    replyToMessageId: string,
    agentIdsByLabel: Record<string, string>,
    optimisticMessage?: SpaceMessage,
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
    const content = buildMessageSpans(value, members, agents, draft.selectedAgentIdsByLabel);
    const clientNonce = createClientNonce();
    const optimisticMessage: SpaceMessage = {
      seq: Date.now(),
      id: `optimistic_${clientNonce}`,
      client_nonce: clientNonce,
      local_delivery_state: "sending",
      space_id: spaceId,
      conversation_id: conversationId || undefined,
      sender_user_id: options.currentUser?.id ?? "",
      sender_name: options.currentUser?.name || "You",
      sender_kind: "person",
      content,
      file_node_ids: [...draft.selectedFileIds],
      library_item_ids: [...draft.selectedLibraryIds],
      attachments: [...draft.pendingAttachments],
      reactions: [],
      reply_to_message_id: draft.replyToMessageId || undefined,
      created_at: new Date().toISOString(),
    };
    // Everything the request needs, captured before the draft is cleared.
    const snapshot = {
      selectedFileIds: draft.selectedFileIds,
      selectedLibraryIds: draft.selectedLibraryIds,
      replyToMessageId: draft.replyToMessageId,
      selectedAgentIdsByLabel: draft.selectedAgentIdsByLabel,
    };

    // The composer and message list update together. The server response or
    // realtime event replaces this row by client_nonce; a failure keeps it in
    // place with an explicit delivery error.
    if (conversationId) {
      setGroupMessages((current) => mergeSpaceMessages(current, [optimisticMessage]));
    }
    draft.reset();

    try {
      if (conversationId) {
        const response = await spacesApi.sendConversationMessage(
          spaceId,
          conversationId,
          content,
          snapshot.selectedFileIds,
          attachmentIds,
          snapshot.selectedLibraryIds,
          snapshot.replyToMessageId,
          clientNonce,
        );
        response.message.client_nonce ||= clientNonce;
        response.message.triggered_runs = (response.triggered_runs ?? []).map((run) => ({
          ...run,
          state: run.state as NonNullable<SpaceMessage["triggered_runs"]>[number]["state"],
        }));
        setGroupMessages((current) => mergeSpaceMessages(current, [response.message]));
        options.onAgentRunsQueued(response.message.triggered_runs);
      } else {
        await options.storeSendMessage(
          spaceId,
          value,
          snapshot.selectedFileIds,
          attachmentIds,
          snapshot.selectedLibraryIds,
          snapshot.replyToMessageId,
          snapshot.selectedAgentIdsByLabel,
          optimisticMessage,
        );
      }
    } catch {
      if (conversationId) {
        setGroupMessages((current) =>
          current.map((message) =>
            message.client_nonce === clientNonce && message.local_delivery_state === "sending"
              ? { ...message, local_delivery_state: "failed" }
              : message,
          ),
        );
      }
      // Delivery failures belong to the optimistic row itself. Keeping them
      // out of the conversation load error prevents a failed send from making
      // the entire thread look unavailable.
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

let fallbackNonce = 0;

function createClientNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `client_${crypto.randomUUID()}`;
  }
  fallbackNonce += 1;
  return `client_${Date.now()}_${fallbackNonce}`;
}
