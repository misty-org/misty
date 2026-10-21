import { create } from "zustand";
import {
  conversationFoldersApi,
  type AgentConversationFolder,
} from "@/api/assistant/conversationFolders";
import { localChats } from "@/features/misty/localChats";
import { useMistyStore } from "@/features/misty/useMistyStore";

export type { AgentConversationFolder };

interface AgentFoldersStore {
  accountId: string;
  folders: AgentConversationFolder[];
  load(accountId: string): Promise<void>;
  create(agentId: string, name: string): Promise<AgentConversationFolder>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Moves a conversation into a folder, or back to Recents with an empty id. */
  file(conversationId: string, folderId: string): Promise<void>;
}

/** Files conversations; the chat saves itself on this device with its new folder. */
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

/**
 * The agent folders on this device. Folders group chats, and chats live on the device
 * that keeps them (docs/design/agent-chats-local/BRIEF.md), so folders do too. The
 * account's folders from before are copied once.
 */
export const useAgentFoldersStore = create<AgentFoldersStore>((set, get) => ({
  accountId: "",
  folders: [],
  load: async (accountId) => {
    if (accountId !== get().accountId) set({ accountId, folders: [] });
    if (!accountId) return;
    if (!localChats.available()) {
      const { folders } = await conversationFoldersApi.list();
      if (get().accountId === accountId) set({ folders });
      return;
    }
    if (!(await localChats.imported(accountId, "folders"))) {
      const earlier = await conversationFoldersApi.list().catch(() => null);
      if (earlier) {
        await Promise.all(
          earlier.folders.map((folder) => localChats.saveFolder(accountId, folder)),
        );
        await localChats.markImported(accountId, "folders");
      }
    }
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
    // Its conversations go back to Recents.
    setConversationFolder((folderId) => folderId === id, "");
  },
  file: async (conversationId, folderId) => {
    setConversationFolder((_, id) => id === conversationId, folderId);
  },
}));
