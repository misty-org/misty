import { create } from "zustand";
import { notify } from "@misty/ui";
import { spacesApi } from "../../api/api";
import type { SpaceMessage } from "../../api/dto/entities";
import { useSpacesStore } from "../../list/useSpacesStore";

/** One chat's pins: the Space-wide chat or a DM when `conversationId` is empty, else a channel. */
export type PinnedList =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "done"; messages: SpaceMessage[] };

interface PinnedState {
  byChat: Record<string, PinnedList>;
  load(spaceId: string, conversationId: string): Promise<void>;
  /** Reads a chat's pins the first time anything asks for them. */
  ensure(spaceId: string, conversationId: string): void;
  setPinned(spaceId: string, conversationId: string, message: SpaceMessage, pinned: boolean): Promise<void>;
}

export const pinnedChatKey = (spaceId: string, conversationId: string) =>
  `${spaceId}:${conversationId}`;

export const usePinnedStore = create<PinnedState>((set, get) => ({
  byChat: {},
  async load(spaceId, conversationId) {
    const key = pinnedChatKey(spaceId, conversationId);
    const current = get().byChat[key];
    // A reload keeps what shows until it answers.
    if (!current || current.status === "failed")
      set((state) => ({ byChat: { ...state.byChat, [key]: { status: "loading" } } }));
    try {
      const messages = await spacesApi.pinnedMessages(spaceId, conversationId);
      set((state) => ({ byChat: { ...state.byChat, [key]: { status: "done", messages } } }));
    } catch {
      if (get().byChat[key]?.status !== "done")
        set((state) => ({ byChat: { ...state.byChat, [key]: { status: "failed" } } }));
    }
  },
  ensure(spaceId, conversationId) {
    if (!get().byChat[pinnedChatKey(spaceId, conversationId)]) void get().load(spaceId, conversationId);
  },
  async setPinned(spaceId, conversationId, message, pinned) {
    const key = pinnedChatKey(spaceId, conversationId);
    const previous = get().byChat[key];
    if (previous?.status === "done") {
      const others = previous.messages.filter((item) => item.id !== message.id);
      set((state) => ({
        byChat: {
          ...state.byChat,
          [key]: { status: "done", messages: pinned ? [message, ...others] : others },
        },
      }));
    }
    try {
      if (pinned) await spacesApi.pinMessage(spaceId, conversationId, message.id);
      else await spacesApi.unpinMessage(spaceId, conversationId, message.id);
    } catch {
      if (previous) set((state) => ({ byChat: { ...state.byChat, [key]: previous } }));
      notify({
        message: pinned ? "Couldn’t pin this message." : "Couldn’t unpin this message.",
        tone: "error",
      });
    }
  },
}));

/** Whether a message is among its chat's pins, as far as this window has read them. */
export function useIsPinned(spaceId: string, conversationId: string, messageId: string): boolean {
  return usePinnedStore((state) => {
    const list = state.byChat[pinnedChatKey(spaceId, conversationId)];
    return list?.status === "done" && list.messages.some((message) => message.id === messageId);
  });
}

/**
 * Whether the person may pin here: anyone in a DM (a DM is a Space id this window doesn't list
 * among the person's Spaces), only those who manage messages in a Space.
 */
export function useCanPin(spaceId: string, canManageMessages: boolean): boolean {
  const isSpace = useSpacesStore((state) => state.spaces.some((space) => space.id === spaceId));
  return canManageMessages || !isSpace;
}
