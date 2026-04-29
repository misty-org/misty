import type { SpaceTask } from "../interfaces/types";

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
  >
>;
