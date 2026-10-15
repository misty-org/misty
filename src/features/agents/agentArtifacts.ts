import { invoke } from "@tauri-apps/api/core";
import { personalAgentsApi } from "@/api/agents/native";
import { uploadLibraryPath, type AgentArtifactProvenance } from "@/api/spaces/library-upload";
import { useSpacesStore } from "@/features/spaces";
import { usePersonalAgentsStore } from "./personalAgentsStore";

/**
 * What agents make is saved to the Space they live in, as Library items that
 * remember which agent, chat and run made them. It counts toward the agent
 * owner's storage. Files stay on this computer too.
 */
export interface AgentArtifactInput {
  agentId: string;
  path: string;
  kind: AgentArtifactProvenance["kind"];
  conversationId?: string;
  runId?: string;
}

/** The Space an agent lives in, with its name for status lines. */
export async function agentHomeSpace(agentId: string): Promise<{ id: string; name: string }> {
  let agent = usePersonalAgentsStore.getState().agents.find((item) => item.id === agentId);
  if (!agent?.space_id)
    agent = (await personalAgentsApi.list()).agents.find((item) => item.id === agentId);
  const spaceId = agent?.space_id;
  if (!spaceId) throw new Error("This agent’s Space couldn’t be found.");
  const space = useSpacesStore.getState().spaces.find((item) => item.id === spaceId);
  return { id: spaceId, name: space?.name ?? "its Space" };
}

export async function saveAgentArtifact(input: AgentArtifactInput) {
  const space = await agentHomeSpace(input.agentId);
  const result = await uploadLibraryPath(space.id, input.path, "library", {
    agent: {
      agent_id: input.agentId,
      conversation_id: input.conversationId,
      run_id: input.runId,
      kind: input.kind,
    },
  });
  return { space, itemId: result.item?.id };
}
