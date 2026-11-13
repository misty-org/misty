import type { AgentProfile } from "@/shared/schemas";
import { Text } from "@/shared/ui";
import { AgentAvatar } from "./AgentAvatar";

/**
 * Which agent a chat belongs to: its picture and name, nothing to press. A chat keeps the agent it
 * was started with; agents are hired and set up in the Studio, never switched from a chat.
 */
export function AgentIdentity({
  agent,
  className = "agent-studio-identity",
}: {
  agent?: AgentProfile;
  className?: string;
}) {
  return (
    <span className={className} data-agent-identity>
      <AgentAvatar agent={agent} />
      <Text size="body" weight="semibold">
        {agent?.name ?? ""}
      </Text>
    </span>
  );
}
