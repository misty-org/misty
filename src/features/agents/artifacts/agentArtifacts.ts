import { spacesSnapshot } from "@/features/app-windows";
import { spacesGateway, type AgentArtifactProvenance } from "../spaces-gateway/spacesGateway";
import { spaceAgentsApi } from "../api/space-agents";

/**
 * What agents make is saved to a Space the agent is in (the personal Space
 * when it's there), as Library items that remember which agent, chat and run
 * made them, or else to the person's own Space as an ordinary item. It counts toward the agent owner's storage. Files stay on this
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
async function agentHomeSpace(
  agentId: string,
): Promise<{ id: string; name: string; member: boolean }> {
  const { agents } = await spaceAgentsApi.mine();
  const memberships = agents.filter((item) => item.agent_id === agentId);
  const spaces = spacesSnapshot().spaces;
  const personal = memberships.find((item) =>
    spaces.some(
      (space) => space.id === item.space_id && space.is_default && space.role === "owner",
    ),
  );
  const home = personal ?? memberships[0];
  if (home) return { id: home.space_id, name: home.space_name, member: true };
  // An agent that no Space lists saves to the person's own, under their name alone.
  const own = spaces.find((space) => space.is_default && space.role === "owner");
  if (!own) throw new Error("Sign in to save this to a Space.");
  return { id: own.id, name: own.name, member: false };
}

export async function saveAgentArtifact(input: AgentArtifactInput) {
  const space = await agentHomeSpace(input.agentId);
  const result = await spacesGateway.get().uploadLibraryPath(
    space.id,
    input.path,
    "library",
    space.member
      ? {
          agent: {
            agent_id: input.agentId,
            conversation_id: input.conversationId,
            run_id: input.runId,
            kind: input.kind,
          },
        }
      : undefined,
  );
  return { space, itemId: result.item?.id };
}
