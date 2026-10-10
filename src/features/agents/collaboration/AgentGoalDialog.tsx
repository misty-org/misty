import { Dialog, DialogContent, DialogTitle } from "@/shared/ui";
import { AgentGoalSection } from "./AgentGoalSection";
import { AgentPlanChecklist } from "./AgentPlanChecklist";
import { useCollaborationStore } from "./store";
import "./collaboration.css";

/** The conversation's goal and its live plan, opened from Goal in the mode menu. */
export function AgentGoalDialog({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const state = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId] : undefined,
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="agent-goal-dialog">
        <DialogTitle className="sr-only">Goal</DialogTitle>
        <AgentGoalSection conversationId={conversationId} state={state} />
        <AgentPlanChecklist plan={state?.plan ?? null} goal={state?.goal} />
      </DialogContent>
    </Dialog>
  );
}
