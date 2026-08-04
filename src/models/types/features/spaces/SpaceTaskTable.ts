import { LoaderCircle } from "lucide-react";
import { Button } from "@/ui";
import { Card } from "@/ui";
import { Input } from "@/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/models/types/features/spaces/types";
import type { SpaceMember, SpaceTask } from "@/models/interfaces/features/spaces/types";
import {
  TaskEmptyState,
  TaskInlineSelect,
  taskPriorityOptions,
  taskStatusOptions,
  toLocalInput,
} from "@/features/spaces/SpaceTaskPrimitives";

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
