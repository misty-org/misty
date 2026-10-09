import { useLocalExecution } from "@/features/agents/localExecution";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import { WorkspaceAutopilotBar } from "@/features/agents/WorkspaceAutopilotBar";

/** The control bar while an agent operates the Misty window itself. */
export function MistyOverlayControls() {
  const execution = useLocalExecution((state) => state.execution);
  const name = usePersonalAgentsStore(
    (state) => state.agents.find((agent) => agent.id === execution?.agentId)?.name ?? "Misty",
  );
  return execution?.autopilot ? <WorkspaceAutopilotBar execution={execution} name={name} /> : null;
}
