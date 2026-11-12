import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  OptionSelect,
  Textarea,
} from "@/shared/ui";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Minus,
  User,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { SpaceTask, SpaceTaskInput, SpaceTaskPriority, SpaceTaskStatus } from "./api";
import { taskKey } from "./taskOrdering";
import { fromDateField, priorityLabel, statusLabel, toDateField } from "./taskText";

/** Someone a task can go to: a member (`user:<id>`) or an agent in the Space (`agent:<id>`). */
export type TaskAssignee = { value: string; label: string };

export const assigneeValue = (task: Pick<SpaceTask, "assignee_user_id" | "assignee_agent_id">) =>
  task.assignee_user_id
    ? `user:${task.assignee_user_id}`
    : task.assignee_agent_id
      ? `agent:${task.assignee_agent_id}`
      : "";

const statusIcon: Record<SpaceTaskStatus, LucideIcon> = {
  todo: CircleDashed,
  in_progress: CircleDot,
  done: CircleCheck,
  canceled: CircleSlash,
};
const priorityIcon: Record<SpaceTaskPriority, LucideIcon> = {
  high: ArrowUp,
  medium: Minus,
  low: ArrowDown,
};

const options = <T extends string>(labels: Record<T, string>, icons: Record<T, LucideIcon>) =>
  (Object.keys(labels) as T[]).map((value) => ({
    value,
    label: labels[value],
    icon: icons[value],
  }));

/** One task, new or open for editing. `task` is `null` for a new one. */
export function SpaceTaskDialog(props: {
  task: SpaceTask | null;
  initialStatus: SpaceTaskStatus;
  assignees: TaskAssignee[];
  busy: boolean;
  onClose(): void;
  /** Resolves true once the task is saved. */
  onSave(input: SpaceTaskInput & { title: string }): Promise<boolean>;
  onDelete?(): void;
}) {
  const { task } = props;
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [status, setStatus] = useState<SpaceTaskStatus>(task?.status ?? props.initialStatus);
  const [priority, setPriority] = useState<SpaceTaskPriority>(task?.priority ?? "medium");
  const [assignee, setAssignee] = useState(task ? assigneeValue(task) : "");
  const [due, setDue] = useState(toDateField(task?.due_at));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || props.busy) return;
    const [kind, id = ""] = assignee.split(/:(.*)/);
    const saved = await props.onSave({
      title: title.trim(),
      notes,
      status,
      priority,
      assignee_user_id: kind === "user" ? id : "",
      assignee_agent_id: kind === "agent" ? id : "",
      due_at: fromDateField(due),
    });
    if (saved) props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !props.busy && props.onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-4" onSubmit={(event) => void save(event)}>
          <DialogHeader>
            <DialogTitle>{task ? taskKey(task) : "New task"}</DialogTitle>
          </DialogHeader>
          <Field label="Title">
            <Input
              autoFocus
              required
              maxLength={240}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Notes">
            <Textarea
              rows={5}
              maxLength={20000}
              className="max-h-64 overflow-y-auto"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <OptionSelect
                value={status}
                options={options(statusLabel, statusIcon)}
                onValueChange={(value) => setStatus(value as SpaceTaskStatus)}
              />
            </Field>
            <Field label="Priority">
              <OptionSelect
                value={priority}
                options={options(priorityLabel, priorityIcon)}
                onValueChange={(value) => setPriority(value as SpaceTaskPriority)}
              />
            </Field>
            <Field label="Assigned to">
              <OptionSelect
                value={assignee}
                options={[
                  { value: "", label: "No one", icon: CircleSlash },
                  ...props.assignees.map((assignee) => ({
                    ...assignee,
                    icon: assignee.value.startsWith("agent:") ? Bot : User,
                  })),
                ]}
                onValueChange={setAssignee}
              />
            </Field>
            <Field label="Due">
              <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </Field>
          </div>
          <DialogFooter className="sm:justify-between">
            {props.onDelete ? (
              <Button
                type="button"
                variant="quiet"
                size="lg"
                disabled={props.busy}
                onClick={props.onDelete}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="quiet"
                size="lg"
                disabled={props.busy}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={!title.trim() || props.busy}>
                {task ? "Save" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
