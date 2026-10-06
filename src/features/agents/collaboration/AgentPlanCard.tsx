import { ListChecks } from "lucide-react";
import { useState } from "react";
import { MistyMarkdown } from "@/features/ai-surface/MistyMarkdown";
import { Button } from "@/shared/ui";
import { AgentPlanEditor } from "./AgentPlanEditor";
import { PlanRiskTag } from "./PlanRiskTag";
import { useCollaborationStore } from "./store";
import type { AgentPlan, AgentPlanVersion } from "./types";
import "./collaboration.css";

/**
 * The proposed plan in the transcript. Run plan approves this exact version and
 * starts it in Act mode; Edit saves your changes as a new version; Keep planning
 * hands the conversation back to the composer.
 */
export function AgentPlanCard({
  plan,
  history = [],
  working,
  onRun,
  onKeepPlanning,
}: {
  plan: AgentPlan;
  /** Every version of this conversation's plan, newest first. */
  history?: AgentPlanVersion[];
  working: boolean;
  onRun(prompt: string): void;
  onKeepPlanning(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const payload = plan.plan;
  const earlier = history.filter((item) => item.id !== plan.id);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Misty couldn't update the plan. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (editing)
    return (
      <AgentPlanEditor
        plan={plan}
        onCancel={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  return (
    <section className="agent-plan-card" aria-label={`Proposed plan: ${payload.title}`}>
      <header className="agent-plan-card-head">
        <ListChecks size={15} aria-hidden="true" />
        <span>Proposed plan</span>
        <small>
          Version {plan.version}
          {plan.author === "user" ? " · edited by you" : ""}
        </small>
      </header>
      <h3>{payload.title}</h3>
      {payload.summary && <p className="agent-plan-summary">{payload.summary}</p>}
      <ol className="agent-plan-steps">
        {payload.steps.map((step, index) => (
          <li key={step.id}>
            <span className="agent-plan-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="agent-plan-step-body">
              {step.detail ? (
                <details>
                  <summary>
                    <span>{step.title}</span>
                    <PlanRiskTag risk={step.risk} />
                  </summary>
                  <div className="misty-markdown-message agent-plan-step-detail">
                    <MistyMarkdown>{step.detail}</MistyMarkdown>
                  </div>
                </details>
              ) : (
                <p>
                  <span>{step.title}</span>
                  <PlanRiskTag risk={step.risk} />
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {Boolean(payload.assumptions?.length) && (
        <div className="agent-plan-list">
          <h4>Assumptions</h4>
          <ul>
            {payload.assumptions!.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {Boolean(payload.successCriteria?.length) && (
        <div className="agent-plan-list">
          <h4>Done when</h4>
          <ul>
            {payload.successCriteria!.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {earlier.length > 0 && (
        <details className="agent-plan-history">
          <summary>
            {earlier.length === 1 ? "1 earlier version" : `${earlier.length} earlier versions`}
          </summary>
          <ul>
            {earlier.map((item) => (
              <li key={item.id}>
                <span>Version {item.version}</span>
                <span>{item.title}</span>
                <small>
                  {item.author === "user" ? "Edited by you" : "Proposed"} ·{" "}
                  {item.state === "rejected" ? "dismissed" : item.state}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="agent-question-error">
          {error}
        </p>
      )}
      <div className="agent-plan-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={busy || working}
          onClick={() =>
            void act(async () => onRun(await useCollaborationStore.getState().approvePlan(plan)))
          }
        >
          Run plan
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || working}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onKeepPlanning}>
          Keep planning
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="agent-plan-dismiss"
          disabled={busy || working}
          onClick={() => void act(() => useCollaborationStore.getState().rejectPlan(plan))}
        >
          Dismiss
        </Button>
      </div>
    </section>
  );
}
