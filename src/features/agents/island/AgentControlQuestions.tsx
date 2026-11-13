import { Surface } from "@/shared/ui";
import { AgentActionQuestions } from "./AgentActionQuestions";
import { islandClass } from "./agentControlStatus";

/** The island with no task here: only an agent's question waiting for the person's OK. */
export function AgentControlQuestions() {
  return (
    <Surface
      as="aside"
      tone="card"
      edge="hairline"
      aria-label="Agent questions"
      className={islandClass}
    >
      <AgentActionQuestions />
    </Surface>
  );
}
