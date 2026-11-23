import { invoke } from "@tauri-apps/api/core";

export interface AgentMemoryNote {
  id: string;
  title: string;
  source: string;
  content: string;
  deletable: boolean;
}

export interface AgentMemoryNotes {
  notes: AgentMemoryNote[];
  errors: string[];
}

const scope = (accountId: string, agentId: string, engine: string, conversationId?: string) => ({
  account: accountId,
  agentId,
  engine,
  conversationId: conversationId || null,
});

export const agentMemoryApi = {
  list: (accountId: string, agentId: string, engine: string, conversationId?: string) =>
    invoke<AgentMemoryNotes>(
      "agent_memory_list",
      scope(accountId, agentId, engine, conversationId),
    ),
  delete: (
    accountId: string,
    agentId: string,
    engine: string,
    conversationId: string | undefined,
    noteId: string,
  ) =>
    invoke<void>("agent_memory_delete", {
      ...scope(accountId, agentId, engine, conversationId),
      noteId,
    }),
};
