import { spaceRequest } from "./api";

/** A Library item an agent saved to the Space it lives in. */
export interface SpaceAgentArtifact {
  item_id: string;
  space_id: string;
  display_name: string;
  mime_type: string;
  byte_size: number;
  agent_id?: string;
  agent_name: string;
  owner_user_id: string;
  owner_name: string;
  kind: "download" | "file" | "image" | "code" | "document";
  created_at: string;
  /** Only the agent's owner gets the private conversation and run. */
  conversation_id?: string;
  run_id?: string;
}

export const agentArtifactsApi = {
  list: (spaceId: string, agentId = "") =>
    spaceRequest<{ artifacts: SpaceAgentArtifact[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/agent-artifacts${agentId ? `?agent=${encodeURIComponent(agentId)}` : ""}`,
    ),
};

/** "Researcher, Bob’s agent" — who made an item, for credit lines. */
export function agentArtifactCredit(artifact: SpaceAgentArtifact, currentUserId: string) {
  if (artifact.owner_user_id === currentUserId) return `${artifact.agent_name}, your agent`;
  const owner = artifact.owner_name.trim().split(/\s+/)[0];
  return owner ? `${artifact.agent_name}, ${owner}’s agent` : artifact.agent_name;
}
