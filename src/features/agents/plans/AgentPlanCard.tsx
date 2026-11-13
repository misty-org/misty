import { useState } from "react";
import { MistyMarkdown } from "../runs/markdown/MistyMarkdown";
import { Button, Text } from "@/shared/ui";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { StatusRow, StatusTable } from "../progress/StatusTable";
import { AgentPlanEditor } from "./AgentPlanEditor";
import { PlanRiskTag } from "./PlanRiskTag";
import { useCollaborationStore } from "./store";
import type { AgentPlan, AgentPlanVersion } from "./planTypes";

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
    <section className="grid gap-2.5" aria-label={`Proposed plan: ${payload.title}`}>
      {payload.summary && (
        <Text as="p" wrap size="meta" tone="default" className="m-0 leading-normal">
          {payload.summary}
        </Text>
      )}
      <StatusTable
        label="Plan"
        head={
          <>
            <span>
              Plan · {payload.title} · version {plan.version}
              {plan.author === "user" ? " · edited by you" : ""}
            </span>
            <span>Risk</span>
          </>
        }
      >
        {payload.steps.map((step, index) => (
          <StatusRow
            key={step.id}
            state="plain"
            verb={index + 1}
            meta={<PlanRiskTag risk={step.risk} />}
            sub={
              step.detail ? (
                <details>
                  <summary>Details</summary>
                  <Text
                    as="div"
                    bare
                    size="meta"
                    tone="muted"
                    className="misty-markdown-message mt-1.5"
                  >
                    <MistyMarkdown>{step.detail}</MistyMarkdown>
                  </Text>
                </details>
              ) : undefined
            }
          >
            {step.title}
          </StatusRow>
        ))}
      </StatusTable>
      {Boolean(payload.assumptions?.length) && (
        <PlanList title="Assumptions" items={payload.assumptions!} />
      )}
      {Boolean(payload.successCriteria?.length) && (
        <PlanList title="Done when" items={payload.successCriteria!} />
      )}
      {earlier.length > 0 && (
        <details>
          <Text as="summary" bare size="caption" tone="muted" className="cursor-pointer">
            {earlier.length === 1 ? "1 earlier version" : `${earlier.length} earlier versions`}
          </Text>
          <ul className="m-0 mt-1.5 grid list-none gap-1 p-0 text-caption">
            {earlier.map((item) => (
              <Text
                as="li"
                bare
                tone="default"
                key={item.id}
                className="flex flex-wrap gap-x-2 gap-y-1"
              >
                <span>Version {item.version}</span>
                <span>{item.title}</span>
                <Text as="small" bare tone="muted">
                  {item.author === "user" ? "Edited by you" : "Proposed"} ·{" "}
                  {item.state === "rejected" ? "dismissed" : item.state}
                </Text>
              </Text>
            ))}
          </ul>
        </details>
      )}
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <div className="flex items-center gap-1.5">
        <Button
          variant="primary"
          disabled={busy || working}
          onClick={() =>
            void act(async () => onRun(await useCollaborationStore.getState().approvePlan(plan)))
          }
        >
          Run plan
        </Button>
        <Button disabled={busy || working} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onKeepPlanning}>
          Keep planning
        </Button>
        <Button
          variant="quiet"
          className="ml-auto"
          disabled={busy || working}
          onClick={() => void act(() => useCollaborationStore.getState().rejectPlan(plan))}
        >
          Dismiss
        </Button>
      </div>
    </section>
  );
}

/** A short list under the plan (its assumptions, what done looks like) with a quiet heading. */
function PlanList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <Text as="h4" bare size="caption" tone="muted" weight="medium" className="m-0 mb-1">
        {title}
      </Text>
      <Text as="div" bare size="meta" tone="default">
        <ul className="m-0 grid list-disc gap-0.5 pl-4">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Text>
    </div>
  );
}
