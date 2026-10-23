import { apiRequest } from "@/api/client";

/** A folder the user made to group one agent's conversations. */
export interface AgentConversationFolder {
  id: string;
  agentId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

const folderPath = (id: string) => `/misty/conversation-folders/${encodeURIComponent(id)}`;

export const conversationFoldersApi = {
  list: () => apiRequest<{ folders: AgentConversationFolder[] }>("/misty/conversation-folders"),
  create: (agentId: string, name: string) =>
    apiRequest<AgentConversationFolder>("/misty/conversation-folders", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, name }),
    }),
  rename: (id: string, name: string) =>
    apiRequest<AgentConversationFolder>(folderPath(id), {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  remove: (id: string) => apiRequest(folderPath(id), { method: "DELETE" }),
  /** Files a conversation into one of its agent's folders; an empty id returns it to Recents. */
  file: (conversationId: string, folderId: string) =>
    apiRequest<{ id: string; folderId: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ folder_id: folderId }) },
    ),
};
