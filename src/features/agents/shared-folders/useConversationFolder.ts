import { create } from "zustand";
import { stopFolderChanges } from "../personal/useAgentsStore";

/**
 * The shared folder each conversation can read, or none. Folders are on this
 * computer, so the choice is per device and kept in local storage. A new chat's
 * choice is a draft until the conversation exists.
 */
const storageKey = "misty.conversationFolders.v1";
const writableKey = "misty.conversationFolderWrites.v1";

function load(key = storageKey): Record<string, string> {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(key) ?? "{}") as unknown;
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

function save(byConversation: Record<string, string>, key = storageKey) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(byConversation));
  } catch {
    // Private windows and full storage keep the choice for this session only.
  }
}

interface ConversationFolderState {
  byConversation: Record<string, string>;
  /** The new chat's choice, before it has an id. */
  draft: string | null;
  /** Which folder each conversation may add to and edit: a grant the person gave for this chat. */
  writes: Record<string, string>;
  /** The new chat's write grant, before it has an id. */
  draftWrites: string | null;
  writable(scopeId: string, conversationId: string | undefined): boolean;
  setWritable(conversationId: string | undefined, scopeId: string, writable: boolean): void;
  /** The folder a conversation (or the new chat) can read; null for none. */
  folder(conversationId: string | undefined): string | null;
  setFolder(conversationId: string | undefined, scopeId: string | null): void;
  /** The person picked another folder. "Allow changes" was for the old one, so it goes, natively too. */
  chooseFolder(conversationId: string | undefined, scopeId: string | null): void;
  /** Gives a just-created conversation the new chat's choice. */
  adoptDraft(conversationId: string): void;
  /** Forgets a folder everywhere (it stopped being shared). */
  forget(scopeId: string): void;
}

export const useConversationFolder = create<ConversationFolderState>((set, get) => ({
  byConversation: load(),
  draft: null,
  writes: load(writableKey),
  draftWrites: null,
  writable: (scopeId, conversationId) =>
    conversationId
      ? get().writes[conversationId] === scopeId || get().draftWrites === scopeId
      : get().draftWrites === scopeId,
  setWritable: (conversationId, scopeId, writable) => {
    if (!conversationId) return set({ draftWrites: writable ? scopeId : null });
    const writes = { ...get().writes };
    if (writable) writes[conversationId] = scopeId;
    else delete writes[conversationId];
    save(writes, writableKey);
    set({ writes });
  },
  folder: (conversationId) =>
    conversationId ? (get().byConversation[conversationId] ?? null) : get().draft,
  chooseFolder: (conversationId, scopeId) => {
    void stopFolderChanges(conversationId ?? "draft").catch(() => undefined);
    get().setFolder(conversationId, scopeId);
  },
  setFolder: (conversationId, scopeId) => {
    if (!conversationId) return set({ draft: scopeId, draftWrites: null });
    const byConversation = { ...get().byConversation };
    if (scopeId) byConversation[conversationId] = scopeId;
    else delete byConversation[conversationId];
    save(byConversation);
    // Write access was granted for one folder, so changing folder takes it away.
    const writes = { ...get().writes };
    delete writes[conversationId];
    save(writes, writableKey);
    set({ byConversation, writes });
  },
  adoptDraft: (conversationId) => {
    const { draft } = get();
    const { draftWrites } = get();
    if (draft && !get().byConversation[conversationId]) {
      get().setFolder(conversationId, draft);
      if (draftWrites === draft) get().setWritable(conversationId, draft, true);
    }
    set({ draft: null, draftWrites: null });
  },
  forget: (scopeId) => {
    const byConversation = Object.fromEntries(
      Object.entries(get().byConversation).filter(([, value]) => value !== scopeId),
    );
    save(byConversation);
    const writes = Object.fromEntries(
      Object.entries(get().writes).filter(([, value]) => value !== scopeId),
    );
    save(writes, writableKey);
    set({
      byConversation,
      writes,
      draft: get().draft === scopeId ? null : get().draft,
      draftWrites: get().draftWrites === scopeId ? null : get().draftWrites,
    });
  },
}));
