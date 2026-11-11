import { Pressable, Skeleton } from "@/shared/ui";
import { AgentAvatar } from "../personal/AgentAvatar";
import { useTeammateAgents } from "./teammates";
import { useOfficeAgents } from "./useOfficeAgents";
import "./agentsNow.css";

/**
 * The person's agents and what each is doing now, as a row of cards: one that needs its person
 * comes first and says so, a working one names what it is on, and a resting one only shows it is
 * there. Picking a card opens that agent's chat.
 */
export function AgentsNow(props: { onOpenChat(agentId: string, conversationId: string): void }) {
  const { agents, loading } = useOfficeAgents();
  const teammates = useTeammateAgents((state) => state.agents);
  if (!loading && !agents.length && !teammates.length) return null;
  const order = { "needs-you": 0, working: 1, resting: 2 };
  const sorted = [...agents].sort((a, b) => order[a.state] - order[b.state]);
  return (
    <section className="agents-now" aria-label="Agents">
      {loading
        ? Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="agents-now-card" aria-hidden="true">
              <Skeleton className="size-10 rounded-full" />
              <div className="grid gap-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))
        : sorted.map(({ agent, state, doing, conversationId }) => (
            <Pressable
              key={agent.id}
              type="button"
              className="agents-now-card"
              data-state={state}
              onClick={() => props.onOpenChat(agent.id, conversationId)}
            >
              <AgentAvatar agent={agent} />
              <span className="grid min-w-0 text-left">
                <span className="truncate text-sm font-medium text-cream">{agent.name}</span>
                <span className="agents-now-doing truncate text-xs">
                  {doing || "Nothing running"}
                </span>
              </span>
            </Pressable>
          ))}
      {/* Teammates' agents can be looked at, not asked: each takes requests only from its person. */}
      {teammates.map((mate) => (
        <div key={mate.key} className="agents-now-card" data-state={mate.state}>
          <AgentAvatar />
          <span className="grid min-w-0 text-left">
            <span className="truncate text-sm font-medium text-cream">
              {mate.name} · {mate.owner}
            </span>
            <span className="agents-now-doing truncate text-xs">
              {mate.doing || "Nothing running"}
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}
