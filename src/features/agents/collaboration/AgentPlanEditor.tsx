import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { reorderIds, usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { Button, IconButton, Input, OptionSelect, Textarea } from "@/shared/ui";
import { useCollaborationStore } from "./store";
import type { AgentPlan, AgentPlanStep, PlanRisk } from "./types";

const riskOptions: Array<{ value: PlanRisk; label: string }> = [
  { value: "read", label: "Reads" },
  { value: "draft", label: "Drafts" },
  { value: "write", label: "Changes" },
  { value: "consequential", label: "Asks first" },
  { value: "dangerous", label: "Risky" },
];
const maxSteps = 12;
const moveStepShortcuts = "Alt+Shift+ArrowUp Alt+Shift+ArrowDown";

/**
 * Edits a proposed plan in place: rename, describe, reorder (drag or
 * Alt+Shift+Up/Down), add and remove steps. Saving makes a new version
 * authored by you; the agent sees it on its next planning turn.
 */
export function AgentPlanEditor({
  plan,
  onCancel,
  onSaved,
}: {
  plan: AgentPlan;
  onCancel(): void;
  onSaved(): void;
}) {
  const [title, setTitle] = useState(plan.plan.title);
  const [steps, setSteps] = useState<AgentPlanStep[]>(() =>
    plan.plan.steps.map((step) => ({ ...step })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = steps.map((step) => step.id);
  const move = (next: string[]) =>
    setSteps((current) => next.map((id) => current.find((step) => step.id === id)!));
  const reorder = usePointerReorder({
    scope: `plan-editor:${plan.id}`,
    axis: "y",
    animate: true,
    getDrag: (id) => ({ id, label: steps.find((step) => step.id === id)?.title || "Step" }),
    onDrop: (drag, target, after) => move(reorderIds(ids, [drag.id], target, after)),
    onKeyboardMove: (id, direction) => {
      const target = ids[ids.indexOf(id) + direction];
      if (target) move(reorderIds(ids, [id], target, direction === 1));
    },
  });
  const update = (id: string, change: Partial<AgentPlanStep>) =>
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...change } : step)));
  const addStep = () => {
    let number = steps.length + 1;
    while (ids.includes(`step-${number}`)) number += 1;
    setSteps((current) => [...current, { id: `step-${number}`, title: "", risk: "read" }]);
  };
  const valid = title.trim() && steps.length > 0 && steps.every((step) => step.title.trim());
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await useCollaborationStore.getState().revisePlan(plan, {
        ...plan.plan,
        title: title.trim(),
        steps: steps.map((step) => ({
          ...step,
          title: step.title.trim(),
          detail: step.detail?.trim() || undefined,
        })),
      });
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Misty couldn't save the plan. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="agent-plan-card" aria-label="Edit plan">
      <Input
        aria-label="Plan title"
        value={title}
        maxLength={160}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div {...reorder} role="list" aria-label="Steps" className="agent-plan-edit-steps">
        {steps.map((step, index) => (
          <div
            key={step.id}
            role="listitem"
            data-reorder-item={step.id}
            data-reorder-preview="true"
            className="agent-plan-edit-step"
          >
            <IconButton
              size="xs"
              label={`Move step ${index + 1}`}
              data-reorder-handle
              aria-keyshortcuts={moveStepShortcuts}
            >
              <GripVertical />
            </IconButton>
            <div className="agent-plan-edit-fields">
              <Input
                aria-label={`Step ${index + 1} title`}
                placeholder="What to do"
                value={step.title}
                maxLength={120}
                onChange={(event) => update(step.id, { title: event.target.value })}
              />
              <Textarea
                aria-label={`Step ${index + 1} details`}
                placeholder="Details (optional)"
                rows={2}
                value={step.detail ?? ""}
                maxLength={4000}
                onChange={(event) => update(step.id, { detail: event.target.value })}
              />
            </div>
            <OptionSelect
              aria-label={`Step ${index + 1} risk`}
              value={step.risk}
              options={riskOptions}
              onValueChange={(value) => update(step.id, { risk: value as PlanRisk })}
            />
            <IconButton
              size="xs"
              label={`Remove step ${index + 1}`}
              disabled={steps.length === 1}
              onClick={() => setSteps((current) => current.filter((item) => item.id !== step.id))}
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" disabled={steps.length >= maxSteps} onClick={addStep}>
        <Plus aria-hidden="true" />
        Add step
      </Button>
      {error && (
        <p role="alert" className="agent-question-error">
          {error}
        </p>
      )}
      <div className="agent-plan-actions">
        <Button variant="primary" size="sm" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save as new version"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
