import { Play, Pause, X, Check, ShieldX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useLocalExecution } from "@/features/agents/localExecution";
import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import {
  agentOverlayBarClass,
  WorkspaceAutopilotBar,
} from "@/features/agents/WorkspaceAutopilotBar";

export function usePendingMistyApproval() {
  return useMistyStore((state) =>
    state.conversations
      .find((conversation) => conversation.id === state.activeConversationId)
      ?.messages.map((message) => message.action)
      .find(
        (action) =>
          action &&
          ((action.state === "proposed" && action.requiresConfirmation) ||
            (action.state === "awaiting_approval" && action.approvalId)),
      ),
  );
}

export function MistyApprovalReview() {
  const proposal = usePendingMistyApproval();
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState("");
  const decide = async (approve: boolean) => {
    if (!proposal || deciding) return;
    setDeciding(true);
    setError("");
    try {
      const state = useMistyStore.getState();
      if (!approve) await state.rejectAction(proposal.id);
      else if (proposal.approvalId) await state.approveAgentTask(proposal.id);
      else await state.confirmAction(proposal.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeciding(false);
    }
  };
  return proposal ? (
    <div
      className="flex w-full flex-wrap items-center gap-3 border-t border-charcoal-border px-4 py-3 text-sm"
      aria-label="Pending agent approval"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{proposal.title}</p>
        <p className="mt-1 text-xs text-cream-muted">{proposal.summary}</p>
        {(error || proposal.error) && (
          <p role="alert" className="mt-1 text-xs text-red-300">
            {error || proposal.error}
          </p>
        )}
      </div>
      <Button variant="ghost" disabled={deciding} onClick={() => void decide(false)}>
        <ShieldX className="size-4" /> Deny
      </Button>
      <Button disabled={deciding} onClick={() => void decide(true)}>
        <Check className="size-4" /> Approve
      </Button>
    </div>
  ) : null;
}

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
        <Button
          variant="ghost"
          size="icon"
          aria-label="Resume"
          title="Send a message above to start a task"
          disabled
        >
          <Play className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Pause" title="Pause" disabled>
          <Pause className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close overlay"
          title="Close overlay"
          onClick={() => useMistyStore.getState().closePanel()}
        >
          <X className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
