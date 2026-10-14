import { AgentAvatar } from "@/features/agents/AgentAvatar";
import type { AgentListing } from "@/features/agent-member-requests/api";
import type { AgentProfile } from "@/shared/schemas";
import { agentOwnerLabel } from "./useSpaceAgentMembers";

/** Agent members in the rail's Team popover: whose each one is. Agents have no presence. */
export function AgentTeamRows({
  agents,
  currentUserId,
}: {
  agents: AgentListing[];
  currentUserId: string | undefined;
}) {
  if (!agents.length) return null;
  return (
    <div className="mt-1 grid gap-0.5 border-t border-charcoal-border/60 pt-1.5">
      <p className="m-0 px-1.5 pb-0.5 text-[11px] text-cream-muted">Agents</p>
      {agents.map((agent) => (
        <div
          className="flex min-h-10 items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-charcoal-hover"
          key={`agent:${agent.agent_id}`}
        >
          <span className="inline-flex size-7 shrink-0">
            <AgentAvatar
              agent={
                {
                  id: agent.agent_id,
                  name: agent.agent_name,
                  avatar: agent.agent_avatar ?? {},
                  system_managed: agent.system_managed,
                } as AgentProfile
              }
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{agent.agent_name}</span>
          <span className="shrink-0 text-[10px] text-cream-muted">
            {agentOwnerLabel(agent, currentUserId)}
          </span>
        </div>
      ))}
    </div>
  );
}
