import { create } from "zustand";

/** A message the person sent while an engine's turn was running, waiting for it to end. */
export interface QueuedMessage {
  id: string;
  text: string;
}

interface EngineQueueState {
  byConversation: Record<string, QueuedMessage[]>;
  add(conversationId: string, text: string): void;
  remove(conversationId: string, id: string): void;
  /** Takes the oldest message off the queue. */
  next(conversationId: string): QueuedMessage | undefined;
}

let counter = 0;

/**
 * Messages for an outside engine wait here while its turn runs and go out one at a time when it
 * ends. Misty's own agent takes them as steering instead.
 */
export const useEngineQueue = create<EngineQueueState>((set, get) => ({
  byConversation: {},
  add(conversationId, text) {
    counter += 1;
    const message = { id: `queued-${Date.now()}-${counter}`, text };
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: [...(state.byConversation[conversationId] ?? []), message],
      },
    }));
  },
  remove(conversationId, id) {
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: (state.byConversation[conversationId] ?? []).filter(
          (message) => message.id !== id,
        ),
      },
    }));
  },
  next(conversationId) {
    const [first, ...rest] = get().byConversation[conversationId] ?? [];
    if (!first) return undefined;
    set((state) => ({ byConversation: { ...state.byConversation, [conversationId]: rest } }));
    return first;
  },
}));
