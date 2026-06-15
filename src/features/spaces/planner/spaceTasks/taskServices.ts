import {
  MistySDKError,
  TaskCreateInputSchema,
  TaskUpdateInputSchema,
  type MistyAppSDK,
  type SpaceTask as SDKTask,
} from "@misty/sdk";
import type { spacesApi } from "@/api/spaces/api";
import type { SpaceTask, SpaceTaskSourceRef } from "@/api/spaces/dto/interfaces/types";

export type PlannerTaskServices = Pick<
  typeof spacesApi,
  "tasks" | "createTask" | "updateTask" | "moveTask" | "archiveTask"
>;

function sourceReference(value: unknown): SpaceTaskSourceRef {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MistySDKError("invalid_response", "Invalid task attachment.");
  const item = value as Record<string, unknown>;
  if (
    !["library_item", "task_attachment", "chat_attachment"].includes(String(item.kind)) ||
    typeof item.resource_id !== "string" ||
    (item.display_name !== undefined && typeof item.display_name !== "string") ||
    (item.version !== undefined &&
      (typeof item.version !== "number" || !Number.isInteger(item.version)))
  )
    throw new MistySDKError("invalid_response", "Invalid task attachment.");
  return {
    ...item,
    kind: item.kind as SpaceTaskSourceRef["kind"],
    resource_id: item.resource_id,
    ...(typeof item.display_name === "string" ? { display_name: item.display_name } : {}),
    ...(typeof item.version === "number" ? { version: item.version } : {}),
  };
}

/** Normalize Go's nullable fields at the UI boundary without losing version checks. */
export function plannerTask(task: SDKTask): SpaceTask {
  const { status, priority } = task;
  if (status !== "todo" && status !== "in_progress" && status !== "done" && status !== "canceled")
    throw new MistySDKError("invalid_response", "Unsupported task status.");
  if (priority !== "high" && priority !== "medium" && priority !== "low")
    throw new MistySDKError("invalid_response", "Unsupported task priority.");
  if (task.source_refs !== null && !Array.isArray(task.source_refs))
    throw new MistySDKError("invalid_response", "Invalid task attachments.");
  return {
    ...task,
    status,
    priority,
    due_at: task.due_at ?? undefined,
    completed_at: task.completed_at ?? undefined,
    archived_at: task.archived_at ?? undefined,
    source_refs: (task.source_refs ?? []).map(sourceReference),
  };
}

/** The task UI has no URL transport or access to host credentials. */
export function createSDKTaskServices(misty: MistyAppSDK): PlannerTaskServices {
  return {
    async tasks(spaceID, filters = {}) {
      const result = await misty.server.call("tasks.list", {
        path: { spaceID },
        query: {
          status: filters.status,
          priority: filters.priority,
          assignee_user_id: filters.assigneeUserId,
          assignee_agent_id: filters.assigneeAgentId,
          q: filters.search,
          due_from: filters.dueFrom,
          due_to: filters.dueTo,
          sort: filters.sort,
          cursor: filters.cursor,
          limit: filters.limit,
          include_archived: filters.includeArchived,
        },
      });
      return {
        tasks: (result.tasks ?? []).map(plannerTask),
        next_cursor: result.next_cursor,
        status_totals: { todo: 0, in_progress: 0, done: 0, canceled: 0, ...result.status_totals },
      };
    },
    async createTask(spaceID, task) {
      return plannerTask(
        await misty.server.call("tasks.create", {
          path: { spaceID },
          body: TaskCreateInputSchema.parse(task),
        }),
      );
    },
    async updateTask(spaceID, task, patch) {
      return plannerTask(
        await misty.server.call("tasks.update", {
          path: { spaceID, taskID: task.id },
          body: TaskUpdateInputSchema.parse({ ...task, ...patch }),
        }),
      );
    },
    async moveTask(spaceID, task, status, beforeTaskId) {
      const result = await misty.server.call("tasks.move", {
        path: { spaceID, taskID: task.id },
        body: { version: task.version, status, before_task_id: beforeTaskId || undefined },
      });
      return {
        task: plannerTask(result.task),
        reordered: (result.reordered ?? []).map(plannerTask),
      };
    },
    async archiveTask(spaceID, task) {
      return plannerTask(
        await misty.server.call("tasks.delete", {
          path: { spaceID, taskID: task.id },
          query: { version: task.version },
        }),
      );
    },
  };
}
