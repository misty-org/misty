import { usePersonalAgentsStore } from "./personalAgentsStore";
import { AgentAvatar } from "./AgentPicture";

export { AgentAvatar, AgentCloudImage } from "./AgentPicture";

/**
 * An agent known only by its id (a Space message's sender, a mention, a task's assignee), drawn
 * as `AgentAvatar` draws it: its engine's logo. An agent this device doesn't know shows Misty's
 * own mark, never a generic agent glyph.
 */
export function AgentMark({ agentId }: { agentId?: string }) {
  const agent = usePersonalAgentsStore((state) =>
    agentId ? state.agents.find((item) => item.id === agentId) : undefined,
  );
  return <AgentAvatar agent={agent} compact />;
}
