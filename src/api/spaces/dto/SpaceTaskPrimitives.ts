import type { SpaceTask } from "./entities";
import type { SpaceTaskPriority, SpaceTaskStatus } from "./common";

export type TaskDraft = {
  title: string;
  notes: string;
  status: SpaceTaskStatus;
  priority: SpaceTaskPriority;
  assignee_user_id: string;
  due_at: string;
  due_timezone: string;
  source_refs: SpaceTask["source_refs"];
};
