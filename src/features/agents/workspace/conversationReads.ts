import { useMistyStore } from "@/features/misty/useMistyStore";
import { runtimeAssistantApi } from "../AgentsRuntime";

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

const pending = new Set<string>();

/**
 * Marks a conversation read for the account. The dot clears at once; other devices
 * follow the `conversation-reads` account topic. A failed save keeps the local read
 * (retrying here would loop while the conversation stays open); the next conversation
 * reload brings back the account's value.
 */
export function markConversationRead(conversationId: string) {
  if (pending.has(conversationId)) return;
  pending.add(conversationId);
  const accountId = useMistyStore.getState().accountId;
  setReadAt(conversationId, new Date().toISOString());
  void runtimeAssistantApi
    .markConversationRead(conversationId)
    .then(({ lastReadAt }) => {
      if (useMistyStore.getState().accountId === accountId) setReadAt(conversationId, lastReadAt);
    })
    .catch(() => undefined)
    .finally(() => pending.delete(conversationId));
}
