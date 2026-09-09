import { create } from "zustand";

/**
 * The project each conversation works in, or none (docs/plans/agent-code-projects.md).
 * Projects are folders on this computer, so the choice is per device and kept
 * in local storage. A new chat's choice is a draft until the conversation exists.
 */
const storageKey = "misty.conversationProjects.v1";

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

interface ConversationProjectState {
  byConversation: Record<string, string>;
  /** The new chat's choice, before it has an id. */
  draft: string | null;
  /** The project a conversation (or the new chat) uses; null for none. */
  project(conversationId: string | undefined): string | null;
  setProject(conversationId: string | undefined, scopeId: string | null): void;
  /** Gives a just-created conversation the new chat's choice. */
  adoptDraft(conversationId: string): void;
  /** Forgets a project everywhere (it was removed). */
  forget(scopeId: string): void;
}

export const useConversationProject = create<ConversationProjectState>((set, get) => ({
  byConversation: load(),
  draft: null,
  project: (conversationId) =>
    conversationId ? (get().byConversation[conversationId] ?? null) : get().draft,
  setProject: (conversationId, scopeId) => {
    if (!conversationId) return set({ draft: scopeId });
    const byConversation = { ...get().byConversation };
    if (scopeId) byConversation[conversationId] = scopeId;
    else delete byConversation[conversationId];
    save(byConversation);
    set({ byConversation });
  },
  adoptDraft: (conversationId) => {
    const { draft } = get();
    if (draft && !get().byConversation[conversationId]) get().setProject(conversationId, draft);
    set({ draft: null });
  },
  forget: (scopeId) => {
    const byConversation = Object.fromEntries(
      Object.entries(get().byConversation).filter(([, value]) => value !== scopeId),
    );
    save(byConversation);
    set({ byConversation, draft: get().draft === scopeId ? null : get().draft });
  },
}));
