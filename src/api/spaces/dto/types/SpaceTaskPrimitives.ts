import type { SpaceTask } from "../interfaces/types";
import type { SpaceTaskPriority, SpaceTaskStatus } from "./types";

export type TaskDraft = {
  title: string;
  notes: string;
  status: SpaceTaskStatus;
  priority: SpaceTaskPriority;
  assignee_user_id: string;
  assignee_agent_id: string;
  due_at: string;
  due_timezone: string;
  source_refs: SpaceTask["source_refs"];
};
