import type { ComponentProps, ReactNode } from "react";
import { Button } from "@misty/ui";
import { AgentPlanCard } from "../../plans/AgentPlanCard";
import type { AgentPlan, AgentPlanVersion } from "../../plans/plan_types";
import { AgentConversationView } from "./AgentConversationView";

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
  showCreate: boolean;
  onCreate: () => void;
}) {
  if (view.conversation?.messages.length)
    return (
      <>
        <AgentConversationView {...view} />
        {plan && (
          <div className="px-4 pb-5">
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
    <div className="grid h-full place-items-center">
      <Button variant="secondary" onClick={onCreate}>
        Create an agent
      </Button>
    </div>
  );
}
