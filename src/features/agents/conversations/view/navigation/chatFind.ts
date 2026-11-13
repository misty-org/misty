import { useSyncExternalStore } from "react";

/**
 * A find another surface asked a chat to show when it opens: search opens a chat at the words it
 * matched. One at a time; the chat takes it once its messages are on screen.
 */
let pending: { conversationId: string; query: string } | undefined;
const listeners = new Set<() => void>();

export function requestChatFind(conversationId: string, query: string) {
  pending = { conversationId, query: query.trim() };
  for (const listener of listeners) listener();
}

/** The words waiting for `conversationId`, without taking them. */
export function usePendingChatFind(conversationId: string | undefined): string | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (pending && pending.conversationId === conversationId ? pending.query : undefined),
  );
}

export function takeChatFind(conversationId: string) {
  if (pending?.conversationId === conversationId) pending = undefined;
}
