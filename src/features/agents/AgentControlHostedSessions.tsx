import { Square } from "lucide-react";
import { IconButton } from "@/shared/ui";
import type { AgentProfile } from "@/shared/schemas";
import { AgentActionQuestions } from "./AgentActionQuestions";
import { endHostedSession } from "./hostedSessions";
import type { HostedSession } from "./hostedSessionsState";
import { islandClass } from "./agentControlStatus";

/** The island with no task here: which agents work on this computer for another device. */
export function AgentControlHostedSessions({
  hosted,
  agents,
}: {
  hosted: HostedSession[];
  agents: AgentProfile[];
}) {
  return (
    <aside aria-label="Agents working here" className={islandClass}>
      <AgentActionQuestions />
      {hosted.map((session) => (
        <div key={session.taskId} className="flex items-center gap-2 pl-2">
          <p className="min-w-0 flex-1 truncate text-sm" role="status">
            {agents.find((agent) => agent.id === session.agentId)?.name || "An agent"} is working
            here for one of your other devices
          </p>
          <IconButton label="Stop" size="sm" onClick={() => void endHostedSession(session.taskId)}>
            <Square aria-hidden="true" />
          </IconButton>
        </div>
      ))}
    </aside>
  );
}
