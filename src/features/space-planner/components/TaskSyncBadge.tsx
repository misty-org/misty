import { CalendarClock, CircleAlert, CloudOff, TriangleAlert, Upload } from "lucide-react";

import { syncStateLabel, taskSyncState } from "@/features/space-connections";
import type { SpaceTask } from "@/services/spaces/dto/interfaces/types";
import type { TaskSyncState } from "@/services/spaces/dto/types/connections/calendarTasks";
import { Badge } from "@/shared/ui";

/**
 * The one place a task admits where it lives and whether Google agrees.
 *
 * Misty-only tasks show nothing — most tasks are Misty-only, and a badge on
 * every card would be noise rather than information.
 */
export function TaskSyncBadge({ task }: { task: SpaceTask }) {
  const state = taskSyncState(task.schedule, task.calendar, {
    conflicted: Boolean(task.conflicted_fields?.length),
  });
  if (!state) return null;

  const { icon: Icon, variant } = presentation(state);
  return (
    <Badge variant={variant} className="h-5 gap-1 px-1.5 text-[10px]" title={detail(task, state)}>
      <Icon className="size-2.5" aria-hidden />
      {syncStateLabel(state)}
    </Badge>
  );
}

function presentation(state: TaskSyncState) {
  switch (state) {
    case "conflict":
      return { icon: TriangleAlert, variant: "destructive" as const };
    case "canceled_remotely":
      return { icon: CloudOff, variant: "destructive" as const };
    case "sync_error":
      return { icon: CircleAlert, variant: "destructive" as const };
    case "unpublished":
    case "draft":
      return { icon: Upload, variant: "outline" as const };
    default:
      return { icon: CalendarClock, variant: "secondary" as const };
  }
}

/** Names the fields at issue, so "Needs review" is actionable rather than vague. */
function detail(task: SpaceTask, state: TaskSyncState): string {
  if (state === "conflict" && task.conflicted_fields?.length) {
    return `Google also changed: ${task.conflicted_fields.join(", ")}. Choose which version to keep.`;
  }
  if (state === "canceled_remotely") return "This event was canceled in Google Calendar.";
  if (state === "draft") return "This task is not on Google Calendar yet.";
  if (state === "unpublished") return "Local edits have not been sent to Google Calendar yet.";
  return syncStateLabel(state);
}
