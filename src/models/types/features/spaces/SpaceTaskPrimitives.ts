import { Flag, ListTodo } from "lucide-react";
import { EmptyState, ErrorState } from "@/ui";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/models/types/features/spaces/types";
import type { SpaceMember, SpaceTask } from "@/models/interfaces/features/spaces/types";
import { Avatar, AvatarFallback } from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";

export type TaskDraft = {
  title: string;
  notes: string;
  status: SpaceTaskStatus;
  priority: SpaceTaskPriority;
  assignee_user_id: string;
  due_at: string;
  due_timezone: string;
};
