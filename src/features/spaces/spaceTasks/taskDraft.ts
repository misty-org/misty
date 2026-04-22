import type { SpaceTask } from "@/models/interfaces/features/spaces/types";
import type { TaskDraft } from "../SpacePlannerViews";
import { toLocalInput } from "../SpaceTaskPrimitives";

export function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const emptyDraft = (): TaskDraft => ({
  title: "",
  notes: "",
  status: "todo",
  priority: "medium",
  assignee_user_id: "",
  due_at: "",
  due_timezone: localTimezone(),
});

export function taskDraft(task: SpaceTask): TaskDraft {
  return {
    title: task.title,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    assignee_user_id: task.assignee_user_id ?? "",
    due_at: task.due_at ? toLocalInput(task.due_at) : "",
    due_timezone: task.due_timezone || "UTC",
  };
}

/** Throws on an unparseable date so the caller surfaces it instead of sending junk. */
export function dueAtForRequest(value: string) {
  if (!value.trim()) return undefined;
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) throw new Error("Enter a valid due date and time.");
  return dueAt.toISOString();
}

/** Create omits empty assignee and due date entirely rather than sending blanks. */
export function createTaskInput(draft: TaskDraft, sourceRefs: SpaceTask["source_refs"] = []) {
  const assigneeUserId = draft.assignee_user_id.trim();
  const dueAt = dueAtForRequest(draft.due_at);
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    status: draft.status,
    priority: draft.priority,
    due_timezone: draft.due_timezone.trim() || "UTC",
    source_refs: sourceRefs,
    ...(assigneeUserId ? { assignee_user_id: assigneeUserId } : {}),
    ...(dueAt ? { due_at: dueAt } : {}),
  };
}
