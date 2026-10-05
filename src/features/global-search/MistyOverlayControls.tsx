import { Play, Pause, X } from "lucide-react";
import { IconButton } from "@/shared/ui";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useLocalExecution } from "@/features/agents/localExecution";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import {
  agentOverlayBarClass,
  WorkspaceAutopilotBar,
} from "@/features/agents/WorkspaceAutopilotBar";

export function MistyOverlayControls() {
  const execution = useLocalExecution((state) => state.execution);
  const name = usePersonalAgentsStore(
    (state) => state.agents.find((agent) => agent.id === execution?.agentId)?.name ?? "Misty",
  );
  const open = useMistyStore((state) => state.panel !== "closed");
  if (execution?.autopilot) return <WorkspaceAutopilotBar execution={execution} name={name} />;
  if (!open) return null;
  return (
    <aside aria-label="Agent control" className={agentOverlayBarClass}>
      <div className="flex items-center gap-1" role="group" aria-label="Playback controls">
        <IconButton size="md" label="Resume" title="Send a message above to start a task" disabled>
          <Play className="size-4" />
        </IconButton>
        <IconButton size="md" label="Pause" disabled>
          <Pause className="size-4" />
        </IconButton>
        <IconButton
          size="md"
          label="Close overlay"
          onClick={() => useMistyStore.getState().closePanel()}
        >
          <X className="size-4" />
        </IconButton>
      </div>
    </aside>
  );
}
