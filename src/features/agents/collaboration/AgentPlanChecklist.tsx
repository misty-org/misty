import { Check, Circle, CircleAlert, CircleMinus, Flag } from "lucide-react";
import { useState } from "react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { Button, Spinner } from "@/shared/ui";
import { PlanRiskTag } from "./PlanRiskTag";
import { useCollaborationStore } from "./store";
import type { AgentGoal, AgentPlan, PlanStepStatus } from "./types";

const statusText: Record<PlanStepStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
  blocked: "Blocked",
};

function StepIcon({ status }: { status: PlanStepStatus }) {
  if (status === "in_progress") return <Spinner size="sm" label={false} />;
  const Icon = { pending: Circle, done: Check, skipped: CircleMinus, blocked: CircleAlert }[status];
  return <Icon size={14} aria-hidden="true" />;
}

/**
 * The plan in the Task drawer. Once approved it is a live checklist the agent
 * ticks off with plan_update; a proposed plan points back to the conversation.
 */
export function AgentPlanChecklist({
  plan,
  goal,
}: {
  plan: AgentPlan | null;
  goal?: AgentGoal | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!plan || plan.state === "superseded" || plan.state === "rejected") return null;
  const activeGoal = goal && (goal.status === "pursuing" || goal.status === "paused");
  // An approved plan becomes a goal: its title and summary are the objective and
  // its success criteria carry over. A running plan continues into it.
  const setAsGoal = async () => {
    setBusy(true);
    setError("");
    try {
      const prompt = await useCollaborationStore.getState().setGoal(plan.conversationId, {
        objective: [plan.plan.title, plan.plan.summary].filter(Boolean).join(": ").slice(0, 2000),
        successCriteria: plan.plan.successCriteria ?? [],
      });
      if (!useMistyStore.getState().working)
        useCollaborationStore.getState().queueTurn(plan.conversationId, prompt);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Misty couldn't set the goal. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const steps = plan.plan.steps;
  const done = steps.filter((step) =>
    ["done", "skipped"].includes(plan.progress[step.id]?.status ?? ""),
  ).length;
  return (
    <section className="agent-plan-checklist" aria-label="Plan">
      <h3>Plan</h3>
      <p className="agent-plan-checklist-title">{plan.plan.title}</p>
      <p className="agent-task-panel-note">
        {plan.state === "proposed"
          ? "Proposed. Review it in the conversation to run, edit or keep planning."
          : plan.state === "completed"
            ? "Every step is done."
            : `${done} of ${steps.length} steps done`}
      </p>
      <ol>
        {steps.map((step) => {
          const progress = plan.progress[step.id];
          const status: PlanStepStatus = progress?.status ?? "pending";
          return (
            <li key={step.id} data-status={status}>
              <span className="agent-plan-check" title={statusText[status]}>
                <StepIcon status={status} />
                <span className="sr-only">{statusText[status]}</span>
              </span>
              <div>
                <p>
                  <span>{step.title}</span>
                  <PlanRiskTag risk={step.risk} />
                </p>
                {progress?.note && <small>{progress.note}</small>}
              </div>
            </li>
          );
        })}
      </ol>
      {plan.state === "approved" && !activeGoal && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          disabled={busy}
          onClick={() => void setAsGoal()}
        >
          <Flag aria-hidden="true" />
          Set as goal
        </Button>
      )}
      {error && (
        <p role="alert" className="agent-question-error">
          {error}
        </p>
      )}
    </section>
  );
}
