import { AgentAvatar } from "@/features/agents/AgentAvatar";
import type { AgentProfile } from "@/shared/schemas";
import { Card, SkeletonList } from "@/shared/ui";
import { Bot } from "lucide-react";
import {
  agentOwnerLabel,
  agentRequestPolicyLabel,
  useSpaceAgentMembers,
} from "./useSpaceAgentMembers";

/**
 * Agents are members of the Space they live in. The list says whose each one
 * is and whether it takes requests; @mention one in the Space chat to ask it.
 */
export function AgentMemberList({
  spaceId,
  currentUserId,
}: {
  spaceId: string;
  currentUserId: string | undefined;
}) {
  const { agents, error } = useSpaceAgentMembers(spaceId);
  return (
    <section aria-label="Agents in this Space" className="mt-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-cream">Agents</h3>
        <p className="m-0 text-xs text-cream-muted">@mention an agent in the chat to ask it</p>
      </div>
      <Card className="overflow-hidden">
        {!agents ? (
          <SkeletonList label="Agents" rows={2} leading="avatar" lines={2} />
        ) : agents.length ? (
          agents.map((agent, index) => (
            <div
              key={agent.agent_id}
              className={`flex min-h-[64px] min-w-0 items-center gap-3 px-4 py-3 ${index ? "border-t border-charcoal-border/60" : ""}`}
            >
              <span className="size-10 shrink-0">
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
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm font-medium text-cream">{agent.agent_name}</p>
                <p className="mb-0 mt-0.5 truncate text-xs text-cream-muted">
                  {agentOwnerLabel(agent, currentUserId)}
                  {agent.agent_role ? ` · ${agent.agent_role}` : ""}
                </p>
              </div>
              <span className="hidden shrink-0 text-xs text-cream-muted sm:inline">
                {agentRequestPolicyLabel(agent)}
              </span>
            </div>
          ))
        ) : (
          <div className="flex items-center gap-3 px-4 py-4 text-xs text-cream-muted">
            <Bot className="size-4 shrink-0" />
            {error ||
              "No agents live here yet. Move one here from its settings on the Agents page."}
          </div>
        )}
      </Card>
    </section>
  );
}
