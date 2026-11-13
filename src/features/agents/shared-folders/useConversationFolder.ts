import { create } from "zustand";
import { useUserStore } from "@/features/account/core";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { agentAccountId } from "../personal/agentAccount";
import { stopFolderChanges } from "../personal/useAgentsStore";

/**
 * The shared folder each conversation can read, or none. Folders are on this computer, so the
 * choice is per device, kept in misty.db by account like the chats themselves. A new chat's
 * choice is a draft until the conversation exists.
 */
interface AccountFolders {
  /** The folder each conversation reads. */
  folders: Record<string, string>;
  /** The folder each conversation may change. */
  writes: Record<string, string>;
}

const empty = (): AccountFolders => ({ folders: {}, writes: {} });

/** Chats remembered per account; the oldest choices go first, as chats come and go. */
const keepPerAccount = 200;

function stringMap(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
}

/** Keeps the most recent `keepPerAccount` entries (the last ones set). */
function capped(map: Record<string, string>): Record<string, string> {
  const entries = Object.entries(map);
  return entries.length > keepPerAccount ? Object.fromEntries(entries.slice(-keepPerAccount)) : map;
}

/** Sets or clears one chat's entry, moving it to the newest end so the cap drops older ones. */
function withEntry(map: Record<string, string>, conversationId: string, scopeId: string | null) {
  const next = { ...map };
  delete next[conversationId];
  if (scopeId) next[conversationId] = scopeId;
  return capped(next);
}

const savedFolders = createDeviceSetting<Record<string, AccountFolders>>({
  scope: "conversation-folders",
  defaults: {},
  normalize: (stored) =>
    Object.fromEntries(
      Object.entries(stored as Record<string, Partial<AccountFolders>>).map(([account, saved]) => [
        account,
        { folders: stringMap(saved?.folders), writes: stringMap(saved?.writes) },
      ]),
    ),
});

/** Changes the signed-in account's saved choices; with nobody signed in nothing is kept. */
function saveForAccount(change: (saved: AccountFolders) => AccountFolders) {
  const account = agentAccountId();
  if (!account) return;
  savedFolders
    .getState()
    .set((current) => ({ ...current, [account]: change(current[account] ?? empty()) }));
}

// Where earlier versions kept the choices: in webview storage, for whoever was signed in.
const legacyFoldersKey = "misty.conversationFolders.v1";
const legacyWritesKey = "misty.conversationFolderWrites.v1";

function readLegacy(key: string): Record<string, string> | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? stringMap(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Moves the old webview choices into the signed-in account once misty.db has answered. */
function moveLegacy() {
  const folders = readLegacy(legacyFoldersKey);
  const writes = readLegacy(legacyWritesKey);
  if (!folders && !writes) return;
  if (!agentAccountId() || !savedFolders.getState().loaded) return;
  try {
    globalThis.localStorage?.removeItem(legacyFoldersKey);
    globalThis.localStorage?.removeItem(legacyWritesKey);
  } catch {
    // Storage can be off; the choices move to misty.db all the same.
  }
  // What misty.db already has wins over the old copy.
  saveForAccount((saved) => ({
    folders: capped({ ...folders, ...saved.folders }),
    writes: capped({ ...writes, ...saved.writes }),
  }));
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
  byConversation: savedFolders.getState().value[agentAccountId()]?.folders ?? {},
  draft: null,
  writes: savedFolders.getState().value[agentAccountId()]?.writes ?? {},
  draftWrites: null,
  // A new chat's grant reaches only a chat that has no folder of its own yet (the one being
  // created, before it adopts the draft), never every chat already using that folder.
  writable: (scopeId, conversationId) =>
    conversationId
      ? get().writes[conversationId] === scopeId ||
        (get().draftWrites === scopeId && !get().byConversation[conversationId])
      : get().draftWrites === scopeId,
  setWritable: (conversationId, scopeId, writable) => {
    if (!conversationId) return set({ draftWrites: writable ? scopeId : null });
    const grant = writable ? scopeId : null;
    set({ writes: withEntry(get().writes, conversationId, grant) });
    saveForAccount((saved) => ({
      ...saved,
      writes: withEntry(saved.writes, conversationId, grant),
    }));
  },
  folder: (conversationId) =>
    conversationId ? (get().byConversation[conversationId] ?? null) : get().draft,
  chooseFolder: (conversationId, scopeId) => {
    void stopFolderChanges(conversationId ?? "draft").catch(() => undefined);
    get().setFolder(conversationId, scopeId);
  },
  setFolder: (conversationId, scopeId) => {
    if (!conversationId) return set({ draft: scopeId, draftWrites: null });
    // Write access was granted for one folder, so changing folder takes it away.
    set({
      byConversation: withEntry(get().byConversation, conversationId, scopeId),
      writes: withEntry(get().writes, conversationId, null),
    });
    saveForAccount((saved) => ({
      folders: withEntry(saved.folders, conversationId, scopeId),
      writes: withEntry(saved.writes, conversationId, null),
    }));
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
    const without = (map: Record<string, string>) =>
      Object.fromEntries(Object.entries(map).filter(([, value]) => value !== scopeId));
    const byConversation = without(get().byConversation);
    const writes = without(get().writes);
    saveForAccount((saved) => ({ folders: without(saved.folders), writes: without(saved.writes) }));
    set({
      byConversation,
      writes,
      draft: get().draft === scopeId ? null : get().draft,
      draftWrites: get().draftWrites === scopeId ? null : get().draftWrites,
    });
  },
}));

/** Shows the signed-in account's saved choices, as misty.db answers and as accounts change. */
function showSaved() {
  const account = agentAccountId();
  const { value, loaded } = savedFolders.getState();
  if (!account || !loaded) return;
  const saved = value[account] ?? empty();
  useConversationFolder.setState({ byConversation: saved.folders, writes: saved.writes });
  moveLegacy();
}

let shownAccount = agentAccountId();
savedFolders.subscribe(showSaved);
useUserStore.subscribe(() => {
  if (agentAccountId() === shownAccount) return;
  shownAccount = agentAccountId();
  // Signed out, no one's choices show.
  if (!shownAccount) useConversationFolder.setState({ byConversation: {}, writes: {} });
  showSaved();
});
