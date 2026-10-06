import { AgentGoalSection } from "./AgentGoalSection";
import { AgentPlanChecklist } from "./AgentPlanChecklist";
import { useCollaborationStore } from "./store";
import "./collaboration.css";

/** Goal and Plan at the top of the Task drawer, for the open conversation. */
export function AgentCollaborationSections({ conversationId }: { conversationId?: string }) {
  const state = useCollaborationStore((s) =>
    conversationId ? s.byConversation[conversationId] : undefined,
  );
  return (
    <>
      <AgentGoalSection conversationId={conversationId} state={state} />
      <AgentPlanChecklist plan={state?.plan ?? null} goal={state?.goal} />
    </>
  );
}
