import {
  Check,
  CircleAlert,
  CirclePause,
  Flag,
  Hourglass,
  MessageCircleQuestion,
} from "lucide-react";
import { useState } from "react";
import { Button, OptionSelect, Progress, Textarea } from "@/shared/ui";
import { pendingQuestionSet, useCollaborationStore } from "./store";
import type { AgentGoal, ConversationCollaboration } from "./types";

const budgets = [
  { value: "500000", label: "Small · 500K tokens" },
  { value: "1500000", label: "Standard · 1.5M tokens" },
  { value: "5000000", label: "Large · 5M tokens" },
];

const format = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** What the goal is doing right now, as an icon and words. */
function goalStatus(goal: AgentGoal, state: ConversationCollaboration) {
  if (goal.status === "pursuing" && state.mode === "plan")
    return { Icon: CirclePause, text: "Paused while planning" };
  if (goal.status === "pursuing" && pendingQuestionSet(state))
    return { Icon: MessageCircleQuestion, text: "Waiting for your answer" };
  switch (goal.status) {
    case "pursuing":
      return { Icon: Flag, text: "Working toward it" };
    case "paused":
      return { Icon: CirclePause, text: "Paused" };
    case "achieved":
      return { Icon: Check, text: "Achieved" };
    case "unmet":
      return { Icon: CircleAlert, text: "Needs you" };
    case "budget_limited":
      return { Icon: Hourglass, text: "Out of budget" };
    default:
      return { Icon: Flag, text: goal.status };
  }
}

/**
 * The conversation's goal in the Task drawer: set one, watch its budget and
 * reports, and pause, resume, raise the budget or clear it. Misty keeps working
 * toward a pursued goal on the server, across turns, until it is met with
 * evidence, blocked, paused or out of budget.
 */
export function AgentGoalSection({
  conversationId,
  state,
}: {
  conversationId?: string;
  state?: ConversationCollaboration;
}) {
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState("");
  const [criteria, setCriteria] = useState("");
  const [budget, setBudget] = useState("1500000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const goal = state?.goal ?? null;
  const run = async (action: () => Promise<string | undefined>) => {
    if (!conversationId) return;
    setBusy(true);
    setError("");
    try {
      const prompt = await action();
      if (prompt) useCollaborationStore.getState().queueTurn(conversationId, prompt);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Misty couldn't update the goal. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    void run(async () => {
      const prompt = await useCollaborationStore.getState().setGoal(conversationId!, {
        objective: objective.trim(),
        successCriteria: criteria
          .split("\n")
          .map((line) => line.replace(/^[-*\s]+/, "").trim())
          .filter(Boolean)
          .slice(0, 10),
        budgetTokens: Number(budget),
      });
      setEditing(false);
      setObjective("");
      setCriteria("");
      return prompt;
    });
  if (editing)
    return (
      <section className="agent-goal-section" aria-label="Set a goal">
        <h3>Goal</h3>
        <Textarea
          aria-label="Goal objective"
          placeholder="What should Misty keep working toward?"
          rows={3}
          maxLength={2000}
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
        <Textarea
          aria-label="Done when"
          placeholder={
            "Done when… (one per line)\n- The weekly review Note exists\n- It lists every open task"
          }
          rows={3}
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
        <OptionSelect
          aria-label="Budget"
          value={budget}
          options={budgets}
          onValueChange={setBudget}
        />
        {error && (
          <p role="alert" className="agent-question-error">
            {error}
          </p>
        )}
        <div className="agent-plan-actions">
          <Button variant="primary" size="sm" disabled={busy || !objective.trim()} onClick={start}>
            Start goal
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </section>
    );
  if (!goal)
    return (
      <section className="agent-goal-section" aria-label="Goal">
        <h3>Goal</h3>
        <p className="agent-task-panel-note">
          {conversationId
            ? "Give Misty an objective to keep working toward across turns, within a budget."
            : "Start a conversation, then set a goal. You can also type /goal and the objective."}
        </p>
        {conversationId && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Flag aria-hidden="true" />
            Set a goal
          </Button>
        )}
      </section>
    );
  const status = goalStatus(goal, state!);
  const used = Math.min(100, Math.round((goal.usedTokens / goal.budgetTokens) * 100));
  const report = goal.lastReport;
  return (
    <section className="agent-goal-section" aria-label="Goal">
      <h3>Goal</h3>
      <p className="agent-goal-objective">{goal.objective}</p>
      <p className="agent-goal-status" role="status">
        <status.Icon size={14} aria-hidden="true" />
        {status.text}
        <small>
          {goal.continuationCount} of {goal.maxContinuations} continuations
        </small>
      </p>
      <div className="agent-goal-budget">
        <Progress
          aria-label="Goal budget used"
          value={used}
          className="h-1.5 bg-cream/10 [&_[data-slot=progress-indicator]]:bg-cream/70"
        />
        <small>
          {format.format(goal.usedTokens)} of {format.format(goal.budgetTokens)} tokens
        </small>
      </div>
      {goal.successCriteria.length > 0 && (
        <div className="agent-plan-list">
          <h4>Done when</h4>
          <ul>
            {goal.successCriteria.map((item) => {
              const proof = report?.evidence?.find(
                (entry) => entry.criterion.trim().toLowerCase() === item.trim().toLowerCase(),
              );
              return (
                <li key={item} data-proven={proof ? true : undefined}>
                  {proof && <Check size={12} aria-label="Proven" />}
                  <span>{item}</span>
                  {proof && <small>{proof.proof}</small>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {report?.summary && (
        <div className="agent-plan-list">
          <h4>Latest report</h4>
          <p className="agent-goal-report">{report.summary}</p>
          {Boolean(report.next_steps?.length) && (
            <ul>
              {report.next_steps!.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="agent-question-error">
          {error}
        </p>
      )}
      <div className="agent-plan-actions">
        {goal.status === "pursuing" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => useCollaborationStore.getState().controlGoal(goal, "paused"))
            }
          >
            Pause
          </Button>
        )}
        {(goal.status === "paused" || goal.status === "unmet") &&
          goal.usedTokens < goal.budgetTokens && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(() => useCollaborationStore.getState().controlGoal(goal, "pursuing"))
              }
            >
              Resume
            </Button>
          )}
        {(goal.status === "budget_limited" || goal.usedTokens >= goal.budgetTokens) &&
          goal.status !== "achieved" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || goal.budgetTokens * 2 > 50_000_000}
              onClick={() =>
                void run(() =>
                  useCollaborationStore
                    .getState()
                    .controlGoal(goal, "pursuing", goal.budgetTokens * 2),
                )
              }
            >
              Double budget and resume
            </Button>
          )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(() => useCollaborationStore.getState().controlGoal(goal, "cleared"))
          }
        >
          {goal.status === "achieved" ? "Done" : "Clear goal"}
        </Button>
        {goal.status !== "pursuing" && goal.status !== "paused" && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>
            New goal
          </Button>
        )}
      </div>
    </section>
  );
}
