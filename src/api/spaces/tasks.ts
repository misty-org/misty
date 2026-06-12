import type {
  GoogleCalendarChoice,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceTask,
  SpaceTaskActivity,
  SpaceTaskMoveResult,
  SpaceTaskPage,
} from "@/api/spaces/dto/interfaces/types";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/api/spaces/dto/types/types";

import type { SpaceRequest } from "./types";

type TaskFilters = {
  status?: SpaceTaskStatus;
  assigneeUserId?: string;
  assigneeAgentId?: string;
  priority?: SpaceTaskPriority;
  search?: string;
  dueFrom?: string;
  dueTo?: string;
  sort?: "rank" | "due" | "updated";
  cursor?: string;
  limit?: number;
  includeArchived?: boolean;
};

export function createSpaceTasksApi(request: SpaceRequest) {
  return {
    tasks: (spaceId: string, filters: TaskFilters = {}) => {
      const query = new URLSearchParams();
      if (filters.status) query.set("status", filters.status);
      if (filters.assigneeUserId) query.set("assignee_user_id", filters.assigneeUserId);
      if (filters.assigneeAgentId) query.set("assignee_agent_id", filters.assigneeAgentId);
      if (filters.priority) query.set("priority", filters.priority);
      if (filters.search) query.set("q", filters.search);
      if (filters.dueFrom) query.set("due_from", filters.dueFrom);
      if (filters.dueTo) query.set("due_to", filters.dueTo);
      if (filters.sort) query.set("sort", filters.sort);
      if (filters.cursor) query.set("cursor", filters.cursor);
      if (filters.limit) query.set("limit", String(filters.limit));
      if (filters.includeArchived) query.set("include_archived", "true");
      return request<SpaceTaskPage>(
        `/spaces/${encodeURIComponent(spaceId)}/tasks${query.size ? `?${query}` : ""}`,
      );
    },
    createTask: (
      spaceId: string,
      task: Pick<SpaceTask, "title" | "notes" | "status" | "priority" | "due_timezone"> &
        Partial<
          Pick<SpaceTask, "assignee_user_id" | "assignee_agent_id" | "due_at" | "source_refs">
        >,
    ) =>
      request<SpaceTask>(`/spaces/${encodeURIComponent(spaceId)}/tasks`, {
        method: "POST",
        body: JSON.stringify(task),
      }),
    updateTask: (
      spaceId: string,
      task: SpaceTask,
      patch: Partial<
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
      >,
    ) =>
      request<SpaceTask>(
        `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(task.id)}`,
        { method: "PATCH", body: JSON.stringify({ ...task, ...patch }) },
      ),
    taskActivity: (spaceId: string, taskId: string) =>
      request<{ activity: SpaceTaskActivity[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(taskId)}/activity`,
      ),
    moveTask: (spaceId: string, task: SpaceTask, status: SpaceTaskStatus, beforeTaskId?: string) =>
      request<SpaceTaskMoveResult>(
        `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(task.id)}/move`,
        {
          method: "POST",
          body: JSON.stringify({
            version: task.version,
            status,
            before_task_id: beforeTaskId || undefined,
          }),
        },
      ),
    archiveTask: (spaceId: string, task: SpaceTask) =>
      request<SpaceTask>(
        `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(task.id)}?version=${task.version}`,
        { method: "DELETE" },
      ),
    calendarEvents: (spaceId: string, from: string, to: string) =>
      request<{ events: SpaceCalendarEvent[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    createCalendarEvent: (
      spaceId: string,
      input: Pick<
        SpaceCalendarEvent,
        "title" | "description" | "location" | "starts_at" | "ends_at" | "all_day" | "timezone"
      >,
    ) =>
      request<SpaceCalendarEvent>(`/spaces/${encodeURIComponent(spaceId)}/calendar/events`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateCalendarEvent: (spaceId: string, event: SpaceCalendarEvent) =>
      request<SpaceCalendarEvent>(
        `/spaces/${encodeURIComponent(spaceId)}/calendar/events/${encodeURIComponent(event.id)}`,
        { method: "PATCH", body: JSON.stringify(event) },
      ),
    deleteCalendarEvent: (spaceId: string, event: SpaceCalendarEvent) =>
      request(
        `/spaces/${encodeURIComponent(spaceId)}/calendar/events/${encodeURIComponent(event.id)}?version=${event.version ?? 1}`,
        { method: "DELETE" },
      ),
    syncCalendarTasks: (spaceId: string, sourceId?: string) =>
      request<{ tasks: SpaceTask[]; synced_at: string; sources: SpaceCalendarSource[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/calendar/sync`,
        { method: "POST", body: JSON.stringify({ source_id: sourceId }) },
      ),
    calendarSources: (spaceId: string) =>
      request<{ sources: SpaceCalendarSource[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/calendar/sources`,
      ),
    googleCalendars: (spaceId: string, integrationId: string) =>
      request<{ calendars: GoogleCalendarChoice[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/calendar/google/calendars?integration_id=${encodeURIComponent(integrationId)}`,
      ),
    publishGoogleCalendar: (
      spaceId: string,
      integrationId: string,
      calendar: GoogleCalendarChoice,
    ) =>
      request<SpaceCalendarSource>(`/spaces/${encodeURIComponent(spaceId)}/calendar/sources`, {
        method: "POST",
        body: JSON.stringify({
          integration_id: integrationId,
          external_calendar_id: calendar.id,
          display_name: calendar.summary,
          timezone: calendar.timeZone || "UTC",
        }),
      }),
    disableCalendarSource: (spaceId: string, sourceId: string) =>
      request(
        `/spaces/${encodeURIComponent(spaceId)}/calendar/sources/${encodeURIComponent(sourceId)}`,
        { method: "DELETE" },
      ),
  };
}
