import { useMistyStore } from "@/features/misty/useMistyStore";
import { AgentCloudImage } from "../components/AgentAvatar";
import { agentCloudAvatar } from "../components/agentCloudAvatars";
import { usePersonalAgentsStore } from "../personalAgentsStore";

/** The cloud of the agent last selected in Misty, falling back the way the Misty panel does. */
export function MistyPanelSprite({ size = 20 }: { size?: number }) {
  const agents = usePersonalAgentsStore((s) => s.agents);
  const selectedAgentId = useMistyStore((s) => s.selectedAgentId);
  const agent =
    agents.find((a) => a.id === selectedAgentId) ??
    agents.find((a) => a.system_managed) ??
    agents[0];
  return (
    <span
      className="inline-flex shrink-0 [&_img]:size-full [&_img]:object-contain [&_picture]:size-full"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <AgentCloudImage variant={agentCloudAvatar(agent)} />
    </span>
  );
}
