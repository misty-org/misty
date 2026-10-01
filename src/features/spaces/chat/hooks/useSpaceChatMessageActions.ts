import type {
  SpaceConversation,
  SpaceMember,
  SpaceMessage,
} from "@/api/spaces/dto/interfaces/types";
import type { SpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import "../SocialRuntime";
import { socialApi as spacesApi } from "../SocialRuntime";
import { buildMessageSpans } from "../store/useSpaceMessageSpansStore";
import { useRef } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { mergeSpaceMessages } from "../store/useSpaceMessageSpansStore";
import type { MessageEditingState } from "./useMessageEditing";
export interface SpaceChatMessageActionsOptions {
  spaceId: string;
  conversationId: string;
  currentUser:
    | {
        id: string;
        name: string;
      }
    | undefined;
  activeConversation: SpaceConversation | undefined;
  members: SpaceMember[];
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
  const { spaceId, conversationId, members, draft, editing } = options;
  const { setGroupMessages, setGroupChatError } = options;
  const reportConversationError = (error: unknown, fallback: string) => {
    if (conversationId) setGroupChatError(error instanceof Error ? error.message : fallback);
  };
  const sending = useRef(new Set<string>());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (draft.isEmpty) return;
    const value = draft.text.trim();
    const content = buildMessageSpans(value, members);
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
    draft.reset();
    await deliver(optimisticMessage, value);
  };
  const deliver = async (message: SpaceMessage, value: string) => {
    const nonce = message.client_nonce;
    if (!nonce || sending.current.has(nonce)) return;
    sending.current.add(nonce);
    const optimistic = { ...message, local_delivery_state: "sending" as const };
    if (conversationId) setGroupMessages((current) => mergeSpaceMessages(current, [optimistic]));
    try {
      if (conversationId) {
        const response = await spacesApi.sendConversationMessage(
          spaceId,
          conversationId,
          message.content,
          message.file_node_ids,
          message.attachments?.map((item) => item.id) ?? [],
          message.library_item_ids ?? [],
          message.reply_to_message_id ?? "",
          nonce,
        );
        response.message.client_nonce ||= nonce;
        setGroupMessages((current) => mergeSpaceMessages(current, [response.message]));
      } else {
        await options.storeSendMessage(
          spaceId,
          value,
          message.file_node_ids,
          message.attachments?.map((item) => item.id) ?? [],
          message.library_item_ids ?? [],
          message.reply_to_message_id ?? "",
          optimistic,
        );
      }
    } catch {
      if (conversationId)
        setGroupMessages((current) =>
          current.map((item) =>
            item.client_nonce === nonce && item.local_delivery_state
              ? { ...item, local_delivery_state: "failed" }
              : item,
          ),
        );
    } finally {
      sending.current.delete(nonce);
    }
  };
  const retry = (message: SpaceMessage) => {
    if (
      message.local_delivery_state !== "failed" ||
      message.sender_user_id !== options.currentUser?.id ||
      (message.conversation_id ?? "") !== conversationId
    )
      return;
    return deliver(
      message,
      message.content
        .map((span) =>
          span.type === "text"
            ? span.text
            : span.type === "mention"
              ? `@${span.label}`
              : span.label,
        )
        .join(""),
    );
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
          buildMessageSpans(value, members),
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
    if (message.space_id !== spaceId || (message.conversation_id ?? "") !== conversationId)
      return false;
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
  return {
    submit,
    retry,
    saveEdited,
    remove,
    toggleReaction,
  };
}
let fallbackNonce = 0;
function createClientNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `client_${crypto.randomUUID()}`;
  }
  fallbackNonce += 1;
  return `client_${Date.now()}_${fallbackNonce}`;
}
