import { useState, type FormEvent } from "react";
import { confirmAction } from "@/lib/confirmAction";
import { errorText } from "@/lib/format";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceTaskStatus } from "@/models/types/features/spaces/types";
import type { SpaceTask } from "@/models/interfaces/features/spaces/types";
import type { TaskDraft } from "../SpacePlannerViews";
import { createTaskInput, dueAtForRequest, emptyDraft, taskDraft } from "./taskDraft";
import { mergeTasks, optimisticMove } from "./taskOrdering";
import type { SpaceTasksData } from "./useSpaceTasksData";

export type TaskPatch = Partial<
  Pick<
    SpaceTask,
    | "title"
    | "notes"
    | "status"
    | "priority"
    | "assignee_user_id"
    | "assignee_agent_id"
    | "due_at"
    | "due_timezone"
    | "source_refs"
  >
>;

/**
 * Creating, saving, moving and archiving tasks, plus the open drawer's draft.
 *
 * `editing` is a three-state value: `undefined` means the drawer is closed,
 * `null` means it is open for a new task, and a task means it is open for edits.
 */
export function useSpaceTaskActions(options: {
  spaceId: string;
  canManage: boolean;
  data: SpaceTasksData;
}) {
  const { spaceId, canManage, data } = options;
  const [editing, setEditing] = useState<SpaceTask | null | undefined>(undefined);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const [busy, setBusy] = useState("");

  const failWith = (reason: unknown) => data.setError(errorText(reason));

  const openCreate = (initialStatus: SpaceTaskStatus = "todo") => {
    setDraft({ ...emptyDraft(), status: initialStatus });
    setEditing(null);
  };

  const openEdit = (task: SpaceTask) => {
    setDraft(taskDraft(task));
    setEditing(task);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !draft.title.trim()) return;
    setBusy("task");
    try {
      const patch = {
        status: draft.status,
        priority: draft.priority,
        assignee_user_id: draft.assignee_user_id || undefined,
        assignee_agent_id: draft.assignee_agent_id || undefined,
        title: draft.title.trim(),
        notes: draft.notes.trim(),
        due_at: dueAtForRequest(draft.due_at),
        due_timezone: draft.due_timezone.trim() || "UTC",
        source_refs: draft.source_refs,
      };
      const saved = editing
        ? await spacesApi.updateTask(spaceId, editing, patch)
        : await spacesApi.createTask(spaceId, createTaskInput(draft));
      data.setTasks((current) => mergeTasks(current, [saved]));
      setEditing(undefined);
      data.setError("");
    } catch (reason) {
      failWith(reason);
    } finally {
      setBusy("");
    }
  };

  const quickCreate = async (title: string, initialStatus: SpaceTaskStatus) => {
    if (!canManage || !title.trim()) return;
    setBusy(`create:${initialStatus}`);
    try {
      const saved = await spacesApi.createTask(
        spaceId,
        createTaskInput({ ...emptyDraft(), title, status: initialStatus }),
      );
      data.setTasks((current) => mergeTasks(current, [saved]));
      data.setError("");
    } catch (reason) {
      failWith(reason);
    } finally {
      setBusy("");
    }
  };

  const updateTask = async (task: SpaceTask, patch: TaskPatch) => {
    setBusy(task.id);
    try {
      const saved = await spacesApi.updateTask(spaceId, task, patch);
      data.setTasks((current) => mergeTasks(current, [saved]));
      return saved;
    } catch (reason) {
      failWith(reason);
      return undefined;
    } finally {
      setBusy("");
    }
  };

  const moveTask = async (task: SpaceTask, nextStatus: SpaceTaskStatus, beforeTaskId?: string) => {
    if (!canManage) return;
    const previous = data.tasks;
    data.setTasks((current) => optimisticMove(current, task.id, nextStatus, beforeTaskId));
    setBusy(task.id);
    try {
      const result = await spacesApi.moveTask(spaceId, task, nextStatus, beforeTaskId);
      data.setTasks((current) =>
        mergeTasks(current, result.reordered.length ? result.reordered : [result.task]),
      );
    } catch (reason) {
      data.setTasks(previous);
      failWith(reason);
    } finally {
      setBusy("");
    }
  };

  const archive = async (task: SpaceTask) => {
    if (!(await confirmAction(`Archive “${task.title}”?`))) return;
    setBusy(task.id);
    try {
      await spacesApi.archiveTask(spaceId, task);
      data.setTasks((current) => current.filter((item) => item.id !== task.id));
      setEditing(undefined);
    } catch (reason) {
      failWith(reason);
    } finally {
      setBusy("");
    }
  };

  return {
    editing,
    setEditing,
    draft,
    setDraft,
    busy,
    setBusy,
    openCreate,
    openEdit,
    save,
    quickCreate,
    updateTask,
    moveTask,
    archive,
  };
}

export type SpaceTaskActions = ReturnType<typeof useSpaceTaskActions>;
