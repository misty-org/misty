import { usePersonalAgentsStore } from "@/features/agents/personalAgentsStore";
import type { ScheduledTask, ScheduledTaskCadence, ScheduledTaskInput } from "@/api/scheduled/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Field,
  Input,
  OptionSelect,
  Textarea,
} from "@/shared/ui";
import { useState, type FormEvent } from "react";
import { weekdayNames } from "./scheduleFormat";
import { useScheduledTasksStore } from "./useScheduledTasksStore";

const cadenceOptions: { value: ScheduledTaskCadence; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function draftFrom(task?: ScheduledTask): ScheduledTaskInput {
  return {
    title: task?.title ?? "",
    agent_id: task?.agent_id,
    prompt: task?.prompt ?? "",
    enabled: task?.enabled ?? true,
    cadence: task?.cadence ?? "daily",
    local_time: task?.local_time ?? "09:00",
    weekday: task?.weekday ?? new Date().getDay(),
    month_day: task?.month_day ?? new Date().getDate(),
    run_on: task?.run_on || today(),
    timezone: task?.timezone || localTimezone(),
  };
}

/** Creates a scheduled task, or edits `task` when one is given. */
export function ScheduledTaskEditor(props: {
  open: boolean;
  task?: ScheduledTask;
  defaultAgentId?: string;
  onOpenChange: (open: boolean) => void;
  onSaved?: (task: ScheduledTask) => void;
}) {
  const agents = usePersonalAgentsStore((s) => s.agents);
  const [draft, setDraft] = useState(() => ({
    ...draftFrom(props.task),
    agent_id:
      props.task?.agent_id ?? props.defaultAgentId ?? agents.find((a) => a.system_managed)?.id,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof ScheduledTaskInput>(key: K, value: ScheduledTaskInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.prompt.trim()) {
      setError("Give the task a name and tell Misty what to do.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const input = { ...draft, run_on: draft.cadence === "once" ? draft.run_on : undefined };
      const store = useScheduledTasksStore.getState();
      const saved = props.task
        ? await store.update(props.task.id, input)
        : await store.create(input);
      props.onSaved?.(saved);
      props.onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The task could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{props.task ? "Edit scheduled task" : "New scheduled task"}</DialogTitle>
        <DialogDescription>
          Misty runs this in the cloud, even when this computer is off, and posts each run to the
          task’s conversation.
        </DialogDescription>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          {!props.task && (
            <Field
              label="Agent"
              hint="This agent handles every run and follow-up in the task’s conversation."
            >
              <OptionSelect
                value={draft.agent_id ?? ""}
                options={agents
                  .filter((a) => a.enabled)
                  .map((a) => ({ value: a.id, label: a.name }))}
                onValueChange={(value) => set("agent_id", value)}
              />
            </Field>
          )}
          <Field label="Name">
            <Input
              value={draft.title}
              maxLength={120}
              placeholder="Morning briefing"
              onChange={(event) => set("title", event.target.value)}
            />
          </Field>
          <Field label="Instructions" hint="Write it the way you would ask Misty in chat.">
            <Textarea
              value={draft.prompt}
              maxLength={8000}
              rows={5}
              placeholder="Summarize what’s due today across my Spaces and anything that changed overnight."
              onChange={(event) => set("prompt", event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Repeats">
              <OptionSelect
                value={draft.cadence}
                options={cadenceOptions}
                onValueChange={(value) => set("cadence", value as ScheduledTaskCadence)}
              />
            </Field>
            <Field label="Time" hint={`Times use ${draft.timezone}.`}>
              <Input
                type="time"
                value={draft.local_time}
                required
                onChange={(event) => set("local_time", event.target.value)}
              />
            </Field>
            {draft.cadence === "once" ? (
              <Field label="Date">
                <Input
                  type="date"
                  value={draft.run_on}
                  min={today()}
                  required
                  onChange={(event) => set("run_on", event.target.value)}
                />
              </Field>
            ) : null}
            {draft.cadence === "weekly" ? (
              <Field label="Day">
                <OptionSelect
                  value={String(draft.weekday)}
                  options={weekdayNames.map((label, value) => ({ value: String(value), label }))}
                  onValueChange={(value) => set("weekday", Number(value))}
                />
              </Field>
            ) : null}
            {draft.cadence === "monthly" ? (
              <Field label="Day of month" hint="Shorter months use their last day.">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.month_day}
                  onChange={(event) =>
                    set("month_day", Math.min(31, Math.max(1, Number(event.target.value) || 1)))
                  }
                />
              </Field>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (!props.task && !draft.agent_id)}>
              {saving ? "Saving…" : props.task ? "Save" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
