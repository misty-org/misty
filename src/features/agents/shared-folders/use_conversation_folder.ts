import { create } from "zustand";
import { useUserStore } from "@/features/account/core";
import { createDeviceSetting } from "@/shared/lib/device_setting";
import { agentAccountId } from "../personal/agent_account";
import { stopFolderChanges } from "../personal/use_agents_store";
import { notify } from "@misty/ui";

interface AccountFolders {
  folders: Record<string, string>;
  writes: Record<string, string>;
}

const empty = (): AccountFolders => ({ folders: {}, writes: {} });

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

function capped(map: Record<string, string>): Record<string, string> {
  const entries = Object.entries(map);
  return entries.length > keepPerAccount ? Object.fromEntries(entries.slice(-keepPerAccount)) : map;
}

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

function saveForAccount(change: (saved: AccountFolders) => AccountFolders) {
  const account = agentAccountId();
  if (!account) return;
  savedFolders
    .getState()
    .set((current) => ({ ...current, [account]: change(current[account] ?? empty()) }));
}

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

function moveLegacy() {
  const folders = readLegacy(legacyFoldersKey);
  const writes = readLegacy(legacyWritesKey);
  if (!folders && !writes) return;
  if (!agentAccountId() || !savedFolders.getState().loaded) return;
  try {
    globalThis.localStorage?.removeItem(legacyFoldersKey);
    globalThis.localStorage?.removeItem(legacyWritesKey);
  } catch {}
  saveForAccount((saved) => ({
    folders: capped({ ...folders, ...saved.folders }),
    writes: capped({ ...writes, ...saved.writes }),
  }));
}

interface ConversationFolderState {
  byConversation: Record<string, string>;
  draft: string | null;
  writes: Record<string, string>;
  draftWrites: string | null;
  writable(scopeId: string, conversationId: string | undefined): boolean;
  setWritable(conversationId: string | undefined, scopeId: string, writable: boolean): void;
  folder(conversationId: string | undefined): string | null;
  setFolder(conversationId: string | undefined, scopeId: string | null): void;
  chooseFolder(conversationId: string | undefined, scopeId: string | null): void;
  adoptDraft(conversationId: string): void;
  forget(scopeId: string): void;
}

export const useConversationFolder = create<ConversationFolderState>((set, get) => ({
  byConversation: savedFolders.getState().value[agentAccountId()]?.folders ?? {},
  draft: null,
  writes: savedFolders.getState().value[agentAccountId()]?.writes ?? {},
  draftWrites: null,
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
    void stopFolderChanges(conversationId ?? "draft").catch(() =>
      notify({ message: "Couldn't turn off changes for the previous folder.", tone: "error" }),
    );
    get().setFolder(conversationId, scopeId);
  },
  setFolder: (conversationId, scopeId) => {
    if (!conversationId) return set({ draft: scopeId, draftWrites: null });
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
  if (!shownAccount) useConversationFolder.setState({ byConversation: {}, writes: {} });
  showSaved();
});
