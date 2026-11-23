import { useMistyStore } from "../conversations/state/use_misty_store";

const time = (value?: string) => (value ? Date.parse(value) || 0 : 0);

export const isUnread = (runUpdatedAt: string, lastReadAt?: string) =>
  time(runUpdatedAt) > time(lastReadAt);

const setReadAt = (conversationId: string, lastReadAt: string) =>
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, lastReadAt } : conversation,
    ),
  }));

export function markConversationRead(conversationId: string) {
  setReadAt(conversationId, new Date().toISOString());
}
