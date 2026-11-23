import { usePersonalAgentsStore } from "./personal_agents_store";
import { AgentAvatar } from "./AgentPicture";

export { AgentAvatar, AgentCloudImage } from "./AgentPicture";

export function AgentMark({ agentId }: { agentId?: string }) {
  const agent = usePersonalAgentsStore((state) =>
    agentId ? state.agents.find((item) => item.id === agentId) : undefined,
  );
  return <AgentAvatar agent={agent} compact />;
}
