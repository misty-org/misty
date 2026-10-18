import { create } from "zustand";

/**
 * The coding tool each conversation hands its project work to, or none for the
 * Settings default (docs/plans/coding-runner-capabilities.md). Tools are installed
 * per computer, so the choice is per device and kept in local storage, like the
 * project. A new chat's choice is a draft until the conversation exists.
 */
const storageKey = "misty.conversationCodingTools.v1";

function load(): Record<string, string> {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  } catch {
    return {};
  }
}

function save(byConversation: Record<string, string>) {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(byConversation));
  } catch {
    // Private windows and full storage keep the choice for this session only.
  }
}

interface ConversationCodingToolState {
  byConversation: Record<string, string>;
  /** The new chat's choice, before it has an id. */
  draft: string | null;
  /** The tool id a conversation (or the new chat) uses; null for the Settings default. */
  tool(conversationId: string | undefined): string | null;
  setTool(conversationId: string | undefined, toolId: string | null): void;
  /** Gives a just-created conversation the new chat's choice. */
  adoptDraft(conversationId: string): void;
}

export const useConversationCodingTool = create<ConversationCodingToolState>((set, get) => ({
  byConversation: load(),
  draft: null,
  tool: (conversationId) =>
    conversationId ? (get().byConversation[conversationId] ?? null) : get().draft,
  setTool: (conversationId, toolId) => {
    if (!conversationId) return set({ draft: toolId });
    const byConversation = { ...get().byConversation };
    if (toolId) byConversation[conversationId] = toolId;
    else delete byConversation[conversationId];
    save(byConversation);
    set({ byConversation });
  },
  adoptDraft: (conversationId) => {
    const { draft } = get();
    if (draft && !get().byConversation[conversationId]) get().setTool(conversationId, draft);
    set({ draft: null });
  },
}));

/** The tool a turn sends: the conversation's choice, or the new chat's draft. */
export function codingToolForTurn(conversationId: string, startsConversation: boolean) {
  const store = useConversationCodingTool.getState();
  return store.tool(conversationId) ?? (startsConversation ? store.draft : null) ?? undefined;
}
