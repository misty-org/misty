import { useMistyStore } from "@/features/misty/useMistyStore";

const time = (value?: string) => (value ? Date.parse(value) || 0 : 0);

/** A run is unread when it changed after the user last saw its conversation. */
export const isUnread = (runUpdatedAt: string, lastReadAt?: string) =>
  time(runUpdatedAt) > time(lastReadAt);

const setReadAt = (conversationId: string, lastReadAt: string) =>
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, lastReadAt } : conversation,
    ),
  }));

/**
 * Marks a conversation read on this device. Chats live on the device that keeps them
 * (docs/design/agent-chats-local/BRIEF.md), so read state does too: the dot clears at
 * once and is saved with the chat.
 */
export function markConversationRead(conversationId: string) {
  setReadAt(conversationId, new Date().toISOString());
}
