import { CalendarDays, Check, Clock3, Flag } from "lucide-react";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import type {
  SpaceAgendaEntry,
  SpaceRoadmap,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";
import type { CollectionItem } from "@/shared/ui";

type Creator = ReturnType<typeof useSpaceItemCreator>;

const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const taskStatus: Record<string, string> = {
  todo: "To do",
  open: "To do",
  in_progress: "In progress",
  done: "Completed",
  canceled: "Canceled",
  blocked: "Blocked",
};

export function taskItem(t: SpaceTask, creator: Creator, onOpen: () => void): CollectionItem {
  return {
    id: t.id,
    title: t.title,
    icon: t.status === "done" ? <Check /> : <Clock3 />,
    category: taskStatus[t.status] ?? t.status,
    creator: creator(t.created_by_user_id, t.created_by_agent_id),
    metadata: {
      Status: taskStatus[t.status] ?? t.status,
      Priority: t.priority ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1) : "—",
      "Assigned to":
        t.assignee_user_id || t.assignee_agent_id
          ? creator(t.assignee_user_id, t.assignee_agent_id)
          : "Unassigned",
      Due: date(t.due_at),
      Created: date(t.created_at),
    },
    sortValues: {
      Priority: { low: 1, medium: 2, high: 3 }[t.priority],
      Due: t.due_at ? Date.parse(t.due_at) : undefined,
      Created: Date.parse(t.created_at),
    },
    updatedAt: t.updated_at,
    updated: date(t.updated_at),
    onOpen,
  };
}

export function agendaItem(e: SpaceAgendaEntry, onOpen: () => void): CollectionItem {
  return {
    id: e.id,
    title: e.title,
    icon: <CalendarDays />,
    category: dateTime(e.starts_at),
    metadata: {
      Ends: e.ends_at ? dateTime(e.ends_at) : "—",
      "Time zone": e.timezone,
      Location: e.location || "—",
      Status: e.status || "—",
    },
    sortValues: {
      category: Date.parse(e.starts_at),
      Ends: e.ends_at ? Date.parse(e.ends_at) : undefined,
    },
    updated: "—",
    onOpen,
  };
}

export function roadmapItem(r: SpaceRoadmap, creator: Creator, onOpen: () => void): CollectionItem {
  return {
    id: r.id,
    title: r.name,
    icon: <Flag />,
    category: r.archived_at ? "Archived" : "Roadmap",
    creator: creator(r.created_by_user_id),
    metadata: {
      Status: r.archived_at ? "Archived" : "Active",
      Audience: r.audience_kind === "conversation" ? "Conversation" : "Space",
      Created: date(r.created_at),
    },
    sortValues: { Created: Date.parse(r.created_at) },
    updatedAt: r.updated_at,
    updated: date(r.updated_at),
    onOpen,
  };
}
