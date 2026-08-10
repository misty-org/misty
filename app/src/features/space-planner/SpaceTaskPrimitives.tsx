import type {
  SpaceAgentMembership,
  SpaceMember,
  SpaceTask,
} from "@/services/spaces/dto/interfaces/types";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/services/spaces/dto/types/types";
import { avatarInkClass } from "@/shared/lib/avatarPalette";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  cn,
  EmptyState,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { Bot, Flag } from "lucide-react";
export type { TaskDraft } from "@/services/spaces/dto/types/SpaceTaskPrimitives";

export const taskStatusOptions: Array<[SpaceTaskStatus, string]> = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["done", "Done"],
  ["canceled", "Canceled"],
];

export const taskPriorityOptions: Array<[SpaceTaskPriority, string]> = [
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
];

export function TaskInlineSelect({
  value,
  options,
  disabled,
  onChange,
  className,
  label,
}: {
  value: string;
  options: Array<[string, string]>;
  disabled: boolean;
  onChange: (value: string) => void;
  className?: string;
  label: string;
}) {
  const selectedValue = value || "none";
  return (
    <Select
      disabled={disabled}
      value={selectedValue}
      onValueChange={(next) => onChange(next === "none" ? "" : next)}
    >
      <SelectTrigger
        aria-label={label}
        className={`h-8 min-w-0 border-transparent bg-transparent text-xs shadow-none hover:bg-charcoal-card ${className ?? ""}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, optionLabel]) => (
          <SelectItem value={id || "none"} key={id || "none"}>
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TaskMemberAvatar({
  member,
  agent,
  size = "sm",
}: {
  member?: SpaceMember;
  agent?: SpaceAgentMembership;
  size?: "sm" | "md";
}) {
  return (
    <Avatar
      className={size === "md" ? "size-9" : "size-6"}
      title={agent?.name ?? member?.name ?? "Unassigned"}
    >
      <AvatarFallback className={size === "md" ? "text-xs" : "text-[9px]"}>
        {agent ? (
          <Bot className={size === "md" ? "size-4" : "size-3"} />
        ) : member ? (
          memberInitials(member.name)
        ) : (
          "—"
        )}
      </AvatarFallback>
    </Avatar>
  );
}

export function TaskPriorityBadge({ priority }: { priority: SpaceTaskPriority }) {
  const toneClass =
    priority === "high"
      ? "bg-avatar-red"
      : priority === "low"
        ? "bg-avatar-blue"
        : "bg-avatar-yellow";
  return (
    <Badge
      className={cn(
        "gap-1 px-1.5 py-0 text-[10px] font-medium capitalize",
        toneClass,
        avatarInkClass,
      )}
    >
      <Flag className="size-3" />
      {priority}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: SpaceTaskStatus }) {
  return (
    <Badge variant="secondary" className="gap-1.5 font-medium">
      <span className={`size-1.5 rounded-full ${statusDot(status)}`} />
      {taskStatusOptions.find(([id]) => id === status)?.[1] ?? status}
    </Badge>
  );
}

export function TaskEmptyState({
  title = "No tasks yet",
  description = "Tasks matching this view will appear here.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <EmptyState
      className="min-h-56 max-w-none rounded-lg bg-charcoal-card"
      compact
      title={title}
      description={description}
    />
  );
}

export function TaskErrorState({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <ErrorState
      className="mb-3 max-w-none rounded-lg border border-charcoal-active/30 bg-charcoal-active py-4"
      compact
      title="Tasks could not be loaded"
      description={message}
      action={
        <Button size="sm" variant="outline" type="button" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    />
  );
}

export function dueTone(task: SpaceTask) {
  return task.due_at && new Date(task.due_at) < new Date() && task.status !== "done"
    ? "text-cream-bright"
    : "text-cream-muted";
}

export function shortDue(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function memberName(members: SpaceMember[], id?: string) {
  return id
    ? (members.find((member) => member.user_id === id)?.name ?? "Former member")
    : "Unassigned";
}

export function taskAssigneeName(
  members: SpaceMember[],
  agents: SpaceAgentMembership[],
  task: SpaceTask,
) {
  if (task.assignee_agent_id) {
    return (
      agents.find((agent) => agent.agent_id === task.assignee_agent_id)?.name ?? "Former Agent"
    );
  }
  return memberName(members, task.assignee_user_id);
}

export function toLocalInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function memberInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function statusDot(status: SpaceTaskStatus) {
  if (status === "done") return "bg-status-green";
  if (status === "in_progress") return "bg-avatar-blue";
  if (status === "canceled") return "bg-cream-muted";
  return "bg-avatar-gray";
}
