import { create } from "zustand";
import type { AgentConversationFolder } from "../api/conversation_folders";
import { localChats } from "../conversations/state/local_chats";
import { useMistyStore } from "../conversations/state/use_misty_store";

export type { AgentConversationFolder };

interface AgentFoldersStore {
  accountId: string;
  folders: AgentConversationFolder[];
  load(accountId: string): Promise<void>;
  create(agentId: string, name: string): Promise<AgentConversationFolder>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  file(conversationId: string, folderId: string): Promise<void>;
}

const setConversationFolder = (
  match: (folderId?: string, id?: string) => boolean,
  folderId: string,
) =>
  useMistyStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      match(conversation.folderId, conversation.id)
        ? { ...conversation, folderId: folderId || undefined }
        : conversation,
    ),
  }));

export const useAgentFoldersStore = create<AgentFoldersStore>((set, get) => ({
  accountId: "",
  folders: [],
  load: async (accountId) => {
    if (accountId !== get().accountId) set({ accountId, folders: [] });
    if (!accountId) return;
    const folders = await localChats.folders(accountId);
    if (get().accountId === accountId)
      set({ folders: folders.sort((a, b) => a.name.localeCompare(b.name)) });
  },
  create: async (agentId, name) => {
    const accountId = get().accountId;
    const now = new Date().toISOString();
    const folder: AgentConversationFolder = {
      id: `folder_${crypto.randomUUID()}`,
      agentId,
      name: name.trim().slice(0, 80),
      createdAt: now,
      updatedAt: now,
    };
    await localChats.saveFolder(accountId, folder);
    if (get().accountId === accountId)
      set({ folders: [...get().folders.filter((item) => item.id !== folder.id), folder] });
    return folder;
  },
  rename: async (id, name) => {
    const accountId = get().accountId;
    const current = get().folders.find((item) => item.id === id);
    if (!current) return;
    const folder = {
      ...current,
      name: name.trim().slice(0, 80),
      updatedAt: new Date().toISOString(),
    };
    await localChats.saveFolder(accountId, folder);
    if (get().accountId === accountId)
      set({ folders: get().folders.map((item) => (item.id === id ? folder : item)) });
  },
  remove: async (id) => {
    const accountId = get().accountId;
    await localChats.deleteFolder(accountId, id);
    if (get().accountId !== accountId) return;
    set({ folders: get().folders.filter((item) => item.id !== id) });
    setConversationFolder((folderId) => folderId === id, "");
  },
  file: async (conversationId, folderId) => {
    setConversationFolder((_, id) => id === conversationId, folderId);
  },
}));
