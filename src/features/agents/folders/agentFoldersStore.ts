import { create } from "zustand";
import {
  conversationFoldersApi,
  type AgentConversationFolder,
} from "@/api/assistant/conversationFolders";
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

/** Patch the conversation list so a filing shows before the account event's reload. */
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

/** The account's agent folders. Folders are server state; other devices follow the
 * `agent-folders` account topic and reload. */
export const useAgentFoldersStore = create<AgentFoldersStore>((set, get) => ({
  accountId: "",
  folders: [],
  load: async (accountId) => {
    if (accountId !== get().accountId) set({ accountId, folders: [] });
    if (!accountId) return;
    const { folders } = await conversationFoldersApi.list();
    if (get().accountId === accountId) set({ folders });
  },
  create: async (agentId, name) => {
    const accountId = get().accountId;
    const folder = await conversationFoldersApi.create(agentId, name.trim());
    if (get().accountId === accountId)
      set({ folders: [...get().folders.filter((item) => item.id !== folder.id), folder] });
    return folder;
  },
  rename: async (id, name) => {
    const accountId = get().accountId;
    const folder = await conversationFoldersApi.rename(id, name.trim());
    if (get().accountId === accountId)
      set({ folders: get().folders.map((item) => (item.id === id ? folder : item)) });
  },
  remove: async (id) => {
    const accountId = get().accountId;
    await conversationFoldersApi.remove(id);
    if (get().accountId !== accountId) return;
    set({ folders: get().folders.filter((item) => item.id !== id) });
    // The server returned its conversations to Recents.
    setConversationFolder((folderId) => folderId === id, "");
  },
  file: async (conversationId, folderId) => {
    const accountId = get().accountId;
    await conversationFoldersApi.file(conversationId, folderId);
    if (get().accountId === accountId)
      setConversationFolder((_, id) => id === conversationId, folderId);
  },
}));
