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

export interface AgentMemoryScope {
  accountId: string;
  agentId: string;
  engine: string;
  conversationId?: string;
  spaceId?: string;
}

const scope = ({ accountId, agentId, engine, conversationId, spaceId }: AgentMemoryScope) => ({
  account: accountId,
  agentId,
  engine,
  conversationId: conversationId || null,
  spaceId: spaceId || null,
});

export const agentMemoryApi = {
  list: (memory: AgentMemoryScope) => invoke<AgentMemoryNotes>("agent_memory_list", scope(memory)),
  delete: (memory: AgentMemoryScope, noteId: string) =>
    invoke<void>("agent_memory_delete", { ...scope(memory), noteId }),
};

export const SPACE_MEMORY_SOURCE = "Space memory";
