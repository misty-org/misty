import { create } from "zustand";

interface QueuedMessage {
  id: string;
  text: string;
}

interface EngineQueueState {
  byConversation: Record<string, QueuedMessage[]>;
  add(conversationId: string, text: string): void;
  remove(conversationId: string, id: string): void;
  next(conversationId: string): QueuedMessage | undefined;
}

let counter = 0;

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
