import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/shared/ui";
import { AgentPlanCard } from "../collaboration/AgentPlanCard";
import type { AgentPlan, AgentPlanVersion } from "../collaboration/types";
import { AgentConversationView } from "./AgentConversationView";

/** What the conversation's scroll area shows: the transcript and any proposed plan, or an
 * empty state while there are no messages. */
export function AgentConversationTranscript({
  view,
  plan,
  planHistory,
  onRunPlan,
  onKeepPlanning,
  emptyContent,
  showCreate,
  onCreate,
}: {
  view: ComponentProps<typeof AgentConversationView>;
  plan?: AgentPlan;
  planHistory?: AgentPlanVersion[];
  onRunPlan: (prompt: string) => void;
  onKeepPlanning: () => void;
  emptyContent?: ReactNode;
  /** No agent exists yet and conversations have loaded. */
  showCreate: boolean;
  onCreate: () => void;
}) {
  if (view.conversation?.messages.length)
    return (
      <>
        <AgentConversationView {...view} />
        {plan && (
          <div className="agent-plan-slot">
            <AgentPlanCard
              plan={plan}
              history={planHistory}
              working={view.working}
              onRun={onRunPlan}
              onKeepPlanning={onKeepPlanning}
            />
          </div>
        )}
      </>
    );
  if (emptyContent) return emptyContent;
  if (!showCreate) return null;
  return (
    <div className="agent-empty-state">
      <Button variant="secondary" onClick={onCreate}>
        Create an agent
      </Button>
    </div>
  );
}
