import { Surface } from "@misty/ui";
import { AgentActionQuestions } from "./AgentActionQuestions";
import { islandClass } from "./agent_control_status";

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
