import { uploadLibraryPath, type AgentArtifactProvenance } from "@/api/spaces/library-upload";
import { useSpacesStore } from "@/features/spaces";
import { spaceAgentsApi } from "@/api/spaces/space-agents";

/**
 * What agents make is saved to a Space the agent is in (the personal Space
 * when it's there), as Library items that remember which agent, chat and run
 * made them. It counts toward the agent owner's storage. Files stay on this
 * computer too.
 */
interface AgentArtifactInput {
  agentId: string;
  path: string;
  kind: AgentArtifactProvenance["kind"];
  conversationId?: string;
  runId?: string;
}

/** The Space an agent saves to, with its name for status lines. */
async function agentHomeSpace(agentId: string): Promise<{ id: string; name: string }> {
  const { agents } = await spaceAgentsApi.mine();
  const memberships = agents.filter((item) => item.agent_id === agentId);
  const spaces = useSpacesStore.getState().spaces;
  const personal = memberships.find((item) =>
    spaces.some(
      (space) => space.id === item.space_id && space.is_default && space.role === "owner",
    ),
  );
  const home = personal ?? memberships[0];
  if (!home) throw new Error("This agent isn’t in any Space. Add it to one from its settings.");
  return { id: home.space_id, name: home.space_name };
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
