import { spaceRequest } from "../api/api";

export type SpaceTaskStatus = "todo" | "in_progress" | "done" | "canceled";
export type SpaceTaskPriority = "high" | "medium" | "low";

/** One card on a Space's board. It is Space content: every member reads and changes it. */
export interface SpaceTask {
  id: string;
  space_id: string;
  task_number: number;
  title: string;
  notes: string;
  status: SpaceTaskStatus;
  priority: SpaceTaskPriority;
  rank: number;
  /** A task is assigned to a member, or to an agent a member brought into the Space. */
  assignee_user_id?: string;
  assignee_agent_id?: string;
  due_at?: string;
  created_by_user_id: string;
  version: number;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

/** What a create or an edit sets. An edit leaves out what it does not change; `due_at: ""` clears. */
export type SpaceTaskInput = Partial<
  Pick<SpaceTask, "title" | "notes" | "status" | "priority" | "assignee_user_id" | "due_at"> & {
    assignee_agent_id: string;
  }
>;

/** An event on a Space's own calendar. */
export interface SpaceCalendarEvent {
  id: string;
  space_id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  created_by_user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export type SpaceCalendarEventInput = Pick<
  SpaceCalendarEvent,
  "title" | "description" | "location" | "starts_at" | "ends_at" | "all_day" | "timezone"
>;

const tasksPath = (spaceId: string, taskId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`;
const eventsPath = (spaceId: string, eventId = "") =>
  `/spaces/${encodeURIComponent(spaceId)}/calendar/events${
    eventId ? `/${encodeURIComponent(eventId)}` : ""
  }`;

export const plannerApi = {
  tasks: (spaceId: string) => spaceRequest<{ tasks: SpaceTask[] }>(tasksPath(spaceId)),
  createTask: (spaceId: string, task: SpaceTaskInput & { title: string }) =>
    spaceRequest<SpaceTask>(tasksPath(spaceId), { method: "POST", body: JSON.stringify(task) }),
  updateTask: (spaceId: string, taskId: string, patch: SpaceTaskInput) =>
    spaceRequest<SpaceTask>(tasksPath(spaceId, taskId), {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  /** Puts a task in a column, before `beforeTaskId` or at the end. */
  moveTask: (spaceId: string, taskId: string, status: SpaceTaskStatus, beforeTaskId?: string) =>
    spaceRequest<{ task: SpaceTask; reordered: SpaceTask[] }>(
      `${tasksPath(spaceId, taskId)}/move`,
      { method: "POST", body: JSON.stringify({ status, before_task_id: beforeTaskId ?? "" }) },
    ),
  archiveTask: (spaceId: string, taskId: string) =>
    spaceRequest(tasksPath(spaceId, taskId), { method: "DELETE" }),

  events: (spaceId: string, from: string, to: string) =>
    spaceRequest<{ events: SpaceCalendarEvent[] }>(
      `${eventsPath(spaceId)}?${new URLSearchParams({ from, to })}`,
    ),
  createEvent: (spaceId: string, event: SpaceCalendarEventInput) =>
    spaceRequest<SpaceCalendarEvent>(eventsPath(spaceId), {
      method: "POST",
      body: JSON.stringify(event),
    }),
  updateEvent: (spaceId: string, eventId: string, event: SpaceCalendarEventInput) =>
    spaceRequest<SpaceCalendarEvent>(eventsPath(spaceId, eventId), {
      method: "PATCH",
      body: JSON.stringify(event),
    }),
  deleteEvent: (spaceId: string, eventId: string) =>
    spaceRequest(eventsPath(spaceId, eventId), { method: "DELETE" }),
};
