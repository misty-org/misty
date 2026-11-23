import { useSyncExternalStore } from "react";

let pending: { conversationId: string; query: string } | undefined;
const listeners = new Set<() => void>();

export function requestChatFind(conversationId: string, query: string) {
  pending = { conversationId, query: query.trim() };
  for (const listener of listeners) listener();
}

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
