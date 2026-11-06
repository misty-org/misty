import { globalMistyApi } from "@/features/misty/globalMistyApi";
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
 * Marks a conversation read. The dot clears at once, and the server remembers it for the
 * person's other signed-in sessions.
 */
export function markConversationRead(conversationId: string) {
  setReadAt(conversationId, new Date().toISOString());
  void globalMistyApi.markConversationRead(conversationId).catch(() => undefined);
}
