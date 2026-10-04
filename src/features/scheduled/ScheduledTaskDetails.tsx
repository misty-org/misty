import type { ScheduledTask } from "@/api/scheduled/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  NavIsland,
} from "@/shared/ui";
import { CalendarClock, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { describeNextRun, describeSchedule } from "./scheduleFormat";
import { ScheduledTaskEditor } from "./ScheduledTaskEditor";
import { useScheduledTasksStore } from "./useScheduledTasksStore";

/** One task: when it runs, how the last run went, and what to do with it. */
export function ScheduledTaskDetails(props: {
  task: ScheduledTask;
  agentName?: string;
  deletionDisabled?: boolean;
  onDeleted: () => void;
}) {
  const { task } = props;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const store = useScheduledTasksStore.getState();
  const toggle = () =>
    act(() =>
      store.update(task.id, {
        title: task.title,
        agent_id: task.agent_id,
        method_version_id: task.method_version_id,
        method_inputs: task.method_inputs,
        prompt: task.prompt,
        enabled: !task.enabled,
        cadence: task.cadence,
        local_time: task.local_time,
        weekday: task.weekday,
        month_day: task.month_day,
        run_on: task.run_on,
        timezone: task.timezone,
      }),
    );

  return (
    <article className="grid min-w-0 content-start gap-5">
      <header className="grid gap-1">
        <h2 className="break-words text-base font-medium text-cream-bright">{task.title}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-cream-muted">
          <CalendarClock size={15} aria-hidden="true" />
          {describeSchedule(task)}
          <span aria-hidden="true">·</span>
          {describeNextRun(task)}
        </p>
      </header>
      <p className="text-xs text-cream-muted">Runs with {props.agentName || "Misty"}</p>
      {task.method_version_id && (
        <p className="text-xs text-cream-muted">
          Uses a pinned workflow version and saved inputs. Later workflow edits do not change this
          schedule.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void act(() => store.runNow(task.id))}
          disabled={busy || !task.enabled || task.state === "running"}
        >
          <Play className="size-3.5" aria-hidden="true" />
          Run now
        </Button>
        <NavIsland aria-label="Task actions">
          <Button size="xs" variant="ghost" onClick={() => void toggle()} disabled={busy}>
            {task.enabled ? <Pause className="size-3.5" aria-hidden="true" /> : null}
            {task.enabled ? "Pause" : "Resume"}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-cream-muted"
            onClick={() => setConfirmDelete(true)}
            title={
              props.deletionDisabled
                ? "Send or clear your message before deleting this task."
                : undefined
            }
            disabled={busy || props.deletionDisabled}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </Button>
        </NavIsland>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {task.state === "failed" && task.last_error ? (
        <p className="rounded-xl border border-charcoal-border bg-charcoal-bg/60 px-4 py-3 text-sm text-cream">
          The last run didn’t finish: {task.last_error}
        </p>
      ) : null}
      <section aria-labelledby="scheduled-instructions" className="grid gap-2">
        <h3 id="scheduled-instructions" className="text-xs font-medium text-cream-muted">
          Instructions
        </h3>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-cream">
          {task.prompt}
        </p>
      </section>
      <p className="text-xs text-cream-muted">
        {task.run_count === 0
          ? "This task hasn’t run yet."
          : `Ran ${task.run_count} ${task.run_count === 1 ? "time" : "times"}${
              task.last_run_at ? `, last on ${new Date(task.last_run_at).toLocaleString()}` : ""
            }.`}{" "}
        Times use {task.timezone}.
      </p>
      {editing ? (
        <ScheduledTaskEditor open={editing} task={task} onOpenChange={setEditing} />
      ) : null}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete “{task.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            It stops running. Its past runs stay in the conversation.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void act(async () => {
                  await store.remove(task.id);
                  props.onDeleted();
                })
              }
            >
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
