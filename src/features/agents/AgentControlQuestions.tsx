import { AgentActionQuestions } from "./AgentActionQuestions";
import { islandClass } from "./agentControlStatus";

/** The island with no task here: only an agent's question waiting for the person's OK. */
export function AgentControlQuestions() {
  return (
    <aside aria-label="Agent questions" className={islandClass}>
      <AgentActionQuestions />
    </aside>
  );
}
